import { Crypto, Effect, FileSystem, Path, Ref, Schema, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { castDraft, produce } from "immer";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import * as Event from "#/event/index.ts";
import { createTrail, type RunTrail } from "./trail.ts";
import type { BenchResult } from "./result.ts";

type ScheduledTask = Readonly<{
  task: Task.Task;
  runTrail: RunTrail;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIdx: number;
  }>;

type Options = Readonly<{
  bench: Bench.Bench;
  harness: Harness.Harness;
  eventQueue: Event.EventEnqueue;
}>;

const encodeEvent = Schema.encodeEffect(Event.Event);

export const run = Effect.fn("exec/schedule")(
  function* (
    { bench, harness, eventQueue }: Options,
    config: Config,
  ): Effect.fn.Return<
    BenchResult,
    Error,
    | Crypto.Crypto
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshotConcurrency, trailConcurrency } = config;
    const offer = Event.offerTo(eventQueue);

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

    const resultRef = yield* Ref.make<BenchResult>({ tasks: {} });

    const prepareTask = Effect.fn("exec/prepareTask")(
      function* (task: Task.Task) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchId,
          taskName: task.metadata.name,
          trailCount: config.trailCount,
        });
        yield* Effect.logDebug("Preparing task");

        yield* Effect.acquireRelease(
          Event.TaskScheduleEvent.makeEffect({
            ...taskEventFields(task),
            op: "start",
          }).pipe(offer),

          () =>
            Event.TaskScheduleEvent.makeEffect({
              ...taskEventFields(task),
              op: "stop",
            }).pipe(offer),
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
        effect.pipe(Effect.provide(harness.layer)).pipe(
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
          trailCount: config.trailCount,
        });

        const result = yield* Effect.acquireUseRelease(
          Event.TrailScheduleEvent.makeEffect({
            ...trailEventFields(task, trailIdx),
            op: "start",
          }).pipe(offer),

          () => runTrail(trailIdx),
          () =>
            Event.TrailScheduleEvent.makeEffect({
              ...trailEventFields(task, trailIdx),
              op: "stop",
            }).pipe(offer),
        );

        return { task, result };
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
      Stream.range(0, config.trailCount - 1).pipe(
        Stream.flatMap((trailIdx) =>
          Stream.fromIterable(scheduledTasks).pipe(
            Stream.map((scheduledTask): ScheduledTrail => ({ ...scheduledTask, trailIdx })),
          ),
        ),
      );

    const tasks = bench.tasks;

    if (tasks.length === 0) {
      yield* Effect.logWarning("No tasks to schedule");
      return yield* Ref.get(resultRef);
    }

    yield* Effect.logDebug(`Loaded ${tasks.length} task(s)`);

    yield* Event.InitEvent.makeEffect({
      ...evalEventFields,
      benchMetadata: Bench.metadata(bench),
      harnessMetadata: Harness.metadata(harness),
    }).pipe(offer);

    yield* Effect.acquireRelease(
      Event.EvalScheduleEvent.makeEffect({
        ...evalEventFields,
        op: "start",
      }).pipe(offer),

      () =>
        Event.EvalScheduleEvent.makeEffect({
          ...evalEventFields,
          op: "stop",
        }).pipe(offer),
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
    );

    const benchMetrics = yield* Effect.forEach(bench.metrics, Metric.Bench.run);
    yield* completedTrails.pipe(
      Stream.runForEach(({ task, result }) =>
        Ref.update(resultRef, (benchResult) =>
          produce(benchResult, (draft) => {
            const taskResult = draft.tasks[task.metadata.id];
            if (taskResult) {
              taskResult.trails.push(castDraft(result));
            } else {
              draft.tasks[task.metadata.id] = { trails: [castDraft(result)] };
            }
          }),
        ).pipe(
          Effect.andThen(
            Effect.forEach(
              benchMetrics,
              (run) =>
                run({
                  task: task.metadata.id,
                  grade: result.grade,
                  trajectory: result.trajectory,
                }).pipe(
                  Effect.flatMap(({ id, result, chart }) =>
                    Event.BenchMetricEvent.makeEffect({
                      ...evalEventFields,
                      id,
                      result,
                      chart,
                    }).pipe(offer),
                  ),
                ),
              { concurrency: "unbounded", discard: true },
            ).pipe(Effect.mapError(Error.init)),
          ),
        ),
      ),
    );

    yield* Effect.logDebug("Completed evaluation schedule");
    return yield* Ref.get(resultRef);
  },
  (effect, { bench }) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.metadata.id })),
);
