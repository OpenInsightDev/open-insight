import {
  Cause,
  Effect,
  Fiber,
  FileSystem,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  Stream,
} from "effect";
import type { Config } from "./config.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { createTrail } from "./trail.ts";
import { Error } from "./error.ts";
import { Agent, Sandbox } from "@open-insight/core";
import {
  type Event,
  InitEvent,
  TaskScheduleEvent,
  BenchScheduleEvent,
  MetricsStreamEvent,
  EventTransportService,
} from "./event/index.ts";
import * as Benchmark from "#/benchmark/index.ts";
import { Result } from "./result.ts";
import { castDraft, produce } from "immer";
import type { ChildProcessSpawner } from "effect/unstable/process";

const updateTrailResult =
  ({ task, trailIndex, trajectory, delta }: Metric.Input) =>
  (current: Result): Result =>
    produce(current, (draft) => {
      const taskName = task.name;
      const taskResult = (draft.tasks[taskName] ??= {
        metrics: {},
        trails: [],
      });
      const trailResult = taskResult.trails[trailIndex];

      taskResult.trails[trailIndex] = {
        grades: delta._tag === "Grade" ? delta.result : (trailResult?.grades ?? {}),
        metrics: trailResult?.metrics ?? {},
        trajectory: castDraft(trajectory),
      };
    });

const updateMetricResult =
  (output: Metric.Output) =>
  (current: Result): Result =>
    produce(current, (draft) => {
      Match.value(output).pipe(
        Match.tag("BenchmarkOutput", ({ name, result }) => {
          draft.metrics[name] = result;
        }),
        Match.tag("TaskOutput", ({ name, task, result }) => {
          const taskResult = (draft.tasks[task.name] ??= {
            metrics: {},
            trails: [],
          });

          taskResult.metrics[name] = result;
        }),
        Match.tag("TrajOutput", ({ name, task, trailIndex, result }) => {
          const taskResult = draft.tasks[task.name];
          const trailResult = taskResult?.trails[trailIndex];

          if (trailResult) {
            trailResult.metrics[name] = result;
          }
        }),
        Match.exhaustive,
      );
    });

type ScheduledTask = Readonly<{
  task: Task.Task;
  trail: Effect.Effect<void, Error, Scope.Scope>;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIndex: number;
  }>;

export const run = Effect.fn("exec/schedule")(
  function* (
    {
      trailCount,
      metrics,
      benchmark,
    }: Readonly<{
      trailCount: number;
      metrics: Option.Option<Metric.Metrics>;
      benchmark: Benchmark.Benchmark;
    }>,
    config: Config,
  ): Effect.fn.Return<
    Result,
    Error,
    | Agent.ProviderService
    | Sandbox.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const metricQueue = yield* Queue.bounded<Metric.Input, Cause.Done>(128);
    const eventQueue = yield* Queue.bounded<Event, Cause.Done>(128);
    const transport = yield* Effect.serviceOption(EventTransportService);

    // TODO reasonable default config values
    const { snapshotConcurrency = 32, trailConcurrency = 32 } = config;

    const result = yield* Ref.make<Result>({
      metrics: {},
      tasks: {},
    });

    const offerEvent = (event: Event) => Queue.offer(eventQueue, event);

    yield* Effect.annotateCurrentSpan({
      benchmark: benchmark.name,
    });
    yield* Effect.logDebug("Starting evaluation schedule");

    const prepareTaskSchedule = Effect.fn("exec/prepareTaskSchedule")(
      function* ({ task }: { task: Task.Task }) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchmark.name,
          taskName: task.name,
          trailCount,
        });
        yield* Effect.logDebug("Preparing task schedule");

        const trail = yield* createTrail({ task, metricQueue, eventQueue, config });
        yield* Effect.logDebug("Task snapshot is ready");

        return { task, trail };
      },
      (effect, { task }) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: benchmark.name,
            taskName: task.name,
          }),
        ),
    );

    const scheduleTrail = Effect.fn("exec/scheduleTrail")(
      function* ({ task, trail, trailIndex }: ScheduledTrail) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchmark.name,
          taskName: task.name,
          trailIndex,
          trailCount,
        });

        yield* offerEvent(
          TaskScheduleEvent.make({
            bench: benchmark.name,
            task: task.name,
            trailIndex,
            op: "start",
          }),
        );

        yield* trail;

        yield* offerEvent(
          TaskScheduleEvent.make({
            bench: benchmark.name,
            task: task.name,
            trailIndex,
            op: "stop",
          }),
        );
      },
      (effect, { task }) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: benchmark.name,
            taskName: task.name,
          }),
        ),
    );

    const trailStream = (scheduledTasks: ReadonlyArray<ScheduledTask>) =>
      Stream.range(0, trailCount - 1).pipe(
        Stream.flatMap((trailIndex) =>
          Stream.fromIterable(scheduledTasks).pipe(
            Stream.map((scheduledTask): ScheduledTrail => ({ ...scheduledTask, trailIndex })),
          ),
        ),
      );

    const metricStream = Stream.fromQueue(metricQueue);
    const metricsFiber = yield* Option.match(metrics, {
      onSome: (metrics) =>
        metricStream
          .pipe(
            Stream.tap((input) => Ref.update(result, updateTrailResult(input))),
            Metric.transform({
              metrics,
              trailCount,
              taskCount: benchmark.tasks.length,
            }),
            Stream.tap((output) => Ref.update(result, updateMetricResult(output))),
            Stream.tap((output) =>
              offerEvent(MetricsStreamEvent.make({ bench: benchmark.name, output })),
            ),
            Stream.runDrain,
          )
          .pipe(Effect.mapError(Error.metric))
          .pipe(Effect.tap(() => Effect.logDebug("Completed metrics stream"))),
      onNone: () => metricStream.pipe(Stream.runDrain),
    }).pipe(Effect.forkChild);

    if (metricsFiber) {
      yield* Effect.logDebug("Started metrics stream");
    }

    const runSchedule = Effect.fn("exec/runSchedule")(function* () {
      yield* Effect.logDebug("Loading tasks");
      const loadedTasks = yield* Effect.all(
        benchmark.tasks.map((task) => task.pipe(Effect.mapError(Error.taskLoad))),
        { concurrency: "unbounded" },
      );
      if (loadedTasks.length === 0) {
        yield* Effect.logWarning("No tasks to schedule");
        return;
      }
      yield* Effect.logDebug(`Loaded ${loadedTasks.length} task(s)`);

      yield* offerEvent(
        InitEvent.make({
          bench: benchmark,
          tasks: loadedTasks.map(({ metadata }) => metadata),
          metrics: Option.match(metrics, {
            onSome: (metrics) => metrics.metadata,
            onNone: () => [],
          }),
        }),
      );

      yield* offerEvent(
        BenchScheduleEvent.make({
          bench: benchmark.name,
          op: "start",
        }),
      );

      const scheduledTasks = yield* Effect.all(
        loadedTasks.map((task) => prepareTaskSchedule({ task })),
        { concurrency: snapshotConcurrency },
      );
      yield* Effect.logDebug("All task snapshots are ready");

      yield* trailStream(scheduledTasks).pipe(
        Stream.mapEffect(scheduleTrail, { concurrency: trailConcurrency, unordered: true }),
        Stream.runDrain,
      );

      yield* offerEvent(
        BenchScheduleEvent.make({
          bench: benchmark.name,
          op: "stop",
        }),
      );
    });

    const transportFiber = yield* Stream.fromQueue(eventQueue).pipe(
      (stream) =>
        Option.match(transport, {
          onSome: (transport) => transport.send({ stream }),
          onNone: () => stream.pipe(Stream.runDrain),
        }),
      Effect.forkChild,
    );

    yield* runSchedule()
      .pipe(Effect.ensuring(Queue.end(metricQueue)))
      .pipe(Effect.andThen(Fiber.join(metricsFiber)))
      .pipe(Effect.ensuring(Queue.end(eventQueue)))
      // shutdown eval when transport failed
      .pipe(Effect.raceFirst(Fiber.join(transportFiber)));

    yield* Effect.logDebug("Scheduled all tasks");

    return yield* Ref.get(result);
  },
  (effect, { benchmark }) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        benchmark: benchmark.name,
      }),
    ),
);
