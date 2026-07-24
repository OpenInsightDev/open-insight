import { Array as Arr, Effect, FileSystem, Path, Queue, Schema, Scope, Stream } from "effect";
import { isNotNull } from "effect/Predicate";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import { castDraft, produce } from "immer";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import type * as BenchMetric from "#/metric/bench.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import {
  BenchMetricEvent,
  EvalScheduleEvent,
  type Event,
  type EventEnqueue,
  InitEvent,
  TaskScheduleEvent,
  TrailScheduleEvent,
} from "./event/index.ts";
import { createTrail, type RunTrail } from "./trail.ts";

type BenchMetricInput = Readonly<{
  results: BenchMetric.Results;
  delta: BenchMetric.Delta;
}>;

const MetricResult = Schema.Record(Schema.String, Schema.Json);

type ScheduledTask = Readonly<{
  task: Task.Task;
  runTrail: RunTrail;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIdx: number;
  }>;

type Options = Readonly<{
  trailCount: number;
  bench: Bench.Bench;
  harness: Harness.Harness;
  eventQueue: EventEnqueue;
}>;

export const run = Effect.fn("exec/schedule")(
  function* (
    { trailCount, bench, harness, eventQueue }: Options,
    config: Config,
  ): Effect.fn.Return<
    void,
    Error,
    | Agent.ProviderService
    | Sandbox.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshotConcurrency = 32, trailConcurrency = 32 } = config;
    const offerEvent = (event: Event) => Queue.offer(eventQueue, event);

    const benchId = bench.metadata.id;
    const harnessId = harness.metadata.id;
    const evalEventFields = { bench: benchId, harness: harnessId };
    const taskEventFields = (task: Task.Task) => ({
      ...evalEventFields,
      task: task.metadata.id,
    });
    const trailEventFields = (task: Task.Task, trailIdx: number) => ({
      ...taskEventFields(task),
      trailIdx,
    });

    yield* Effect.annotateCurrentSpan({ benchmark: benchId });
    yield* Effect.logDebug("Starting evaluation schedule");

    const runBenchMetric = Effect.fn("exec/runBenchMetric")(function* (
      metric: Metric.Bench.Metric,
      input: BenchMetricInput,
      prev: Schema.JsonObject | null,
    ) {
      const result = yield* Effect.tryPromise(() =>
        metric.exec(input.results, input.delta, prev),
      ).pipe(Effect.flatMap(Schema.decodeEffect(MetricResult)), Effect.mapError(Error.init));

      yield* offerEvent(
        BenchMetricEvent.make({
          ...evalEventFields,
          id: metric.metadata.id,
          result,
        }),
      );
      return result;
    });

    const prepareTask = Effect.fn("exec/prepareTask")(
      function* (task: Task.Task) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchId,
          taskName: task.metadata.name,
          trailCount,
        });
        yield* Effect.logDebug("Preparing task");

        yield* Effect.acquireRelease(
          offerEvent(
            TaskScheduleEvent.make({
              ...taskEventFields(task),
              op: "start",
            }),
          ),
          () =>
            offerEvent(
              TaskScheduleEvent.make({
                ...taskEventFields(task),
                op: "stop",
              }),
            ),
        );

        const runTrail = yield* createTrail({
          task,
          bench: benchId,
          harness: harnessId,
          eventQueue,
          config,
        });

        yield* Effect.logDebug("Prepared task");
        return { task, runTrail };
      },
      (effect, task) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: benchId,
            taskName: task.metadata.name,
          }),
        ),
    );

    const runScheduledTrail = Effect.fn("exec/runScheduledTrail")(
      function* ({ task, runTrail, trailIdx }: ScheduledTrail) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchId,
          taskName: task.metadata.name,
          trailIdx,
          trailCount,
        });

        const result = yield* Effect.acquireUseRelease(
          offerEvent(
            TrailScheduleEvent.make({
              ...trailEventFields(task, trailIdx),
              op: "start",
            }),
          ),
          () => runTrail(trailIdx),
          () =>
            offerEvent(
              TrailScheduleEvent.make({
                ...trailEventFields(task, trailIdx),
                op: "stop",
              }),
            ),
        );

        return result === null ? null : { task, result };
      },
      (effect, { task }) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: benchId,
            taskName: task.metadata.name,
          }),
        ),
    );

    const makeTrailStream = (scheduledTasks: ReadonlyArray<ScheduledTask>) =>
      Stream.range(0, trailCount - 1).pipe(
        Stream.flatMap((trailIdx) =>
          Stream.fromIterable(scheduledTasks).pipe(
            Stream.map((scheduledTask): ScheduledTrail => ({ ...scheduledTask, trailIdx })),
          ),
        ),
      );

    const tasks = bench.tasks;

    if (tasks.length === 0) {
      yield* Effect.logWarning("No tasks to schedule");
      return;
    }

    yield* Effect.logDebug(`Loaded ${tasks.length} task(s)`);
    yield* offerEvent(
      InitEvent.make({
        ...evalEventFields,
        benchMetadata: Bench.metadata(bench),
        harnessMetadata: Harness.metadata(harness),
      }),
    );
    yield* Effect.acquireRelease(
      offerEvent(
        EvalScheduleEvent.make({
          ...evalEventFields,
          op: "start",
        }),
      ),
      () =>
        offerEvent(
          EvalScheduleEvent.make({
            ...evalEventFields,
            op: "stop",
          }),
        ),
    );

    const scheduledTasks = yield* Effect.all(tasks.map(prepareTask), {
      concurrency: snapshotConcurrency,
    });
    yield* Effect.logDebug("Prepared all tasks");

    const completedTrails = makeTrailStream(scheduledTasks).pipe(
      Stream.mapEffect(runScheduledTrail, {
        concurrency: trailConcurrency,
        unordered: true,
      }),
      Stream.filter(isNotNull),
    );

    if (bench.metrics.length === 0) {
      yield* Stream.runDrain(completedTrails);
    } else {
      const metricInputs = completedTrails.pipe(
        Stream.mapAccum(
          (): BenchMetric.Results => ({}),
          (results, { task, result }) => {
            const taskId = task.metadata.id;
            const input = {
              results,
              delta: {
                grade: result.grade,
                trajectory: result.trajectory,
                task: taskId,
              },
            } satisfies BenchMetricInput;
            const nextResults = produce(results, (draft) => {
              (draft[taskId] ??= []).push(castDraft(result));
            });

            return [nextResults, [input]] satisfies readonly [
              BenchMetric.Results,
              ReadonlyArray<BenchMetricInput>,
            ];
          },
        ),
      );
      const metricStreams = yield* metricInputs.pipe(
        Stream.broadcastN({
          n: bench.metrics.length,
          capacity: Math.max(1, trailConcurrency),
        }),
      );

      yield* Effect.forEach(
        Arr.zip(bench.metrics, metricStreams),
        ([metric, stream]) =>
          stream.pipe(
            Stream.runFoldEffect(
              (): Schema.JsonObject | null => null,
              (prev, input) => runBenchMetric(metric, input, prev),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      );
    }

    yield* Effect.logDebug("Completed evaluation schedule");
  },
  (effect, { bench }) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.metadata.id })),
);
