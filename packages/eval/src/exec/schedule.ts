import { Cause, Effect, Fiber, Match, Option, Queue, Ref, Scope, Semaphore, Stream } from "effect";
import type { Config } from "./config.ts";
import * as Task from "../task/index.ts";
import * as Metric from "@/metric/index.ts";
import { createTrail } from "./trail.ts";
import { ExecError } from "./error.ts";
import { Countdown } from "@open-insight/utils";
import { Agent, Sandbox } from "@open-insight/core/internal";
import {
  type Event,
  InitEvent,
  TaskScheduleEvent,
  BenchScheduleEvent,
  MetricsStreamEvent,
  EventTransportService,
} from "./event/index.ts";
import { range } from "effect/Array";
import * as Benchmark from "@/benchmark/index.ts";
import { ExecResult, TaskResult, TrailResult } from "./result/index.ts";
import { produce } from "immer";

const updateTrailResult =
  ({ task, trailIndex, trajectory, delta }: Metric.Input) =>
  (current: ExecResult): ExecResult =>
    produce(current, () => {
      const taskName = task.metadata.name;
      const taskResult = current.tasks[taskName] ?? {
        metrics: {},
        trails: [],
      };

      const trailResult = taskResult.trails[trailIndex] ?? {
        grades: {},
        metrics: {},
        trajectory,
      };

      const trails = Array.from(taskResult.trails);
      trails[trailIndex] = new TrailResult({
        grades: delta._tag === "Grade" ? delta.result : trailResult.grades,
        metrics: trailResult.metrics,
        trajectory,
      });

      return ExecResult.make({
        metrics: current.metrics,
        tasks: {
          ...current.tasks,
          [taskName]: TaskResult.make({
            metrics: taskResult.metrics,
            trails,
          }),
        },
      });
    });

const updateMetricResult =
  (output: Metric.Output) =>
  (current: ExecResult): ExecResult =>
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

export const run = Effect.fn("exec/schedule")(
  function* (
    {
      trailCount,
      tasks,
      metrics,
      metadata,
    }: Readonly<{
      trailCount: number;
      tasks: Task.Tasks;
      metrics: Metric.Metrics | null;
      metadata: Benchmark.Metadata;
    }>,
    { harnessConfig, sandboxConfig }: Config,
  ): Effect.fn.Return<
    ExecResult,
    ExecError,
    Agent.ProviderService | Sandbox.ProviderService | Scope.Scope
  > {
    const { snapshotConcurrency = 1, trailConcurrency = 1 } = harnessConfig ?? {};
    const metricQueue = yield* Queue.bounded<Metric.Input, Cause.Done>(128);
    const eventQueue = yield* Queue.bounded<Event, Cause.Done>(128);
    const transport = yield* Effect.serviceOption(EventTransportService);

    const snapshotSem = yield* Semaphore.make(snapshotConcurrency);
    const snapshotCountdown = yield* Countdown.make(tasks.length);
    const trailSem = yield* Semaphore.make(trailConcurrency);

    const result = yield* Ref.make<ExecResult>({
      metrics: {},
      tasks: {},
    });

    const offerEvent = (event: Event) => Queue.offer(eventQueue, event);

    yield* Effect.annotateCurrentSpan({
      benchmark: metadata.name,
    });
    yield* Effect.logDebug("Starting evaluation schedule");

    const scheduleTrail = Effect.fn("exec/scheduleTrail")(
      function* ({ task }: { task: Task.Task }) {
        yield* Effect.annotateCurrentSpan({
          benchmark: metadata.name,
          taskName: task.metadata.name,
          trailCount,
        });
        yield* Effect.logDebug("Preparing task schedule");

        const trail = yield* createTrail({ task, metricQueue, eventQueue, config: sandboxConfig })
          // snapshot building should also be limited to avoid overwhelming the sandbox provider
          .pipe((create) => snapshotSem.withPermit(create));
        yield* Effect.logDebug("Task snapshot is ready");

        // wait for all snapshots to be built successfully before starting any trails
        // avoid wasting agent resources that will be discarded due to snapshot failures
        yield* snapshotCountdown.open;
        yield* Effect.logDebug("Waiting for all task snapshots");
        yield* snapshotCountdown.await;
        yield* Effect.logDebug("All task snapshots are ready");
        yield* offerEvent(
          TaskScheduleEvent.make({
            bench: metadata.name,
            task: task.metadata.name,
            op: "start",
          }),
        );

        const fibers: Array<Fiber.Fiber<void, ExecError>> = [];

        for (const trailIndex of range(0, trailCount - 1)) {
          yield* Effect.logDebug(`Forking trail ${trailIndex}`);
          const fiber = yield* trail
            .pipe((trail) => trailSem.withPermit(trail))
            .pipe(Effect.forkScoped);
          fibers.push(fiber);
          yield* Effect.yieldNow; // ensure fair scheduling of trails across tasks
        }

        yield* Effect.logDebug("Waiting for task trails");
        // TODO join manually to propagate errors, maybe there is a better way to do this
        yield* Effect.all(
          fibers.map((fiber) => Fiber.join(fiber)),
          { concurrency: "unbounded" },
        );
        yield* Effect.logDebug("Completed task trails");
        yield* offerEvent(
          TaskScheduleEvent.make({
            bench: metadata.name,
            task: task.metadata.name,
            op: "stop",
          }),
        );
      },
      (effect, { task }) =>
        effect
          .pipe(
            Effect.annotateLogs({
              benchmark: metadata.name,
              taskName: task.metadata.name,
            }),
          )
          .pipe(Effect.mapError(ExecError.taskInit({ task: task.metadata }))),
    );

    if (metrics) {
      yield* Effect.logDebug("Starting metrics stream");
      yield* Stream.fromQueue(metricQueue)
        .pipe(
          Stream.tap((input) => Ref.update(result, updateTrailResult(input))),
          Metric.transform({ metrics, trailCount, taskCount: tasks.length }),
          Stream.tap((output) => Ref.update(result, updateMetricResult(output))),
          Stream.tap((output) =>
            offerEvent(MetricsStreamEvent.make({ bench: metadata.name, output })),
          ),
          Stream.runDrain,
        )
        .pipe(Effect.mapError(ExecError.metric));
    }

    yield* Option.match(transport, {
      onSome: (transport) =>
        Effect.gen(function* () {
          const stream = Stream.fromQueue(eventQueue);
          yield* transport.send({ stream });
        }).pipe(Effect.forkChild),
      onNone: () => Effect.void,
    });

    yield* Effect.logDebug("Loading tasks");
    const loadedTasks = yield* Effect.all(
      tasks.map((task) => task.pipe(Effect.mapError(ExecError.taskLoad))),
      { concurrency: "unbounded" },
    );
    yield* Effect.logDebug(`Loaded ${loadedTasks.length} task(s)`);

    const taskMetadata = loadedTasks.map((task) => task.metadata);

    yield* Effect.gen(function* () {
      yield* offerEvent(
        InitEvent.make({
          bench: metadata,
          tasks: taskMetadata,
          metrics: metrics?.metadata ?? [],
        }),
      );

      yield* offerEvent(
        BenchScheduleEvent.make({
          bench: metadata.name,
          op: "start",
        }),
      );

      yield* Effect.all(
        loadedTasks.map((task) => scheduleTrail({ task })),
        { concurrency: "unbounded" },
      );

      yield* offerEvent(
        BenchScheduleEvent.make({
          bench: metadata.name,
          op: "stop",
        }),
      );
    })
      .pipe(Effect.ensuring(Queue.end(eventQueue)))
      .pipe(Effect.ensuring(Queue.end(metricQueue)));

    yield* Effect.logDebug("Scheduled all tasks");

    return yield* Ref.get(result);
  },
  (effect, { metadata }) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        benchmark: metadata.name,
      }),
      Effect.awaitAllChildren,
    ),
);
