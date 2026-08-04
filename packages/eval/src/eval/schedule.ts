import { Crypto, DateTime, Effect, FileSystem, Path, Ref, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { castDraft, produce } from "immer";
import * as Bench from "#/bench/index.ts";
import { Harness } from "@open-insight/core/internal";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import * as Event from "#/event/index.ts";
import { createTrail, type RunTrail } from "./trail.ts";
import { BenchResult, TaskResult } from "./result.ts";

type ScheduledTask = Readonly<{
  task: Task.AnyTask;
  runTrail: RunTrail;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIdx: number;
  }>;

type Options = Readonly<{
  bench: Bench.Bench;
  eventQueue: Event.EventEnqueue;
}>;

export const run = Effect.fn("exec/schedule")(
  function* (
    { bench, eventQueue }: Options,
    config: Config,
  ): Effect.fn.Return<
    BenchResult,
    EvalError,
    | Crypto.Crypto
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
    | Harness.Service
  > {
    const { snapshotConcurrency, trailConcurrency } = config;
    const offer = Event.offerTo(eventQueue);

    const benchId = bench.metadata.id;
    const harness = yield* Harness.Service;
    const evalEventFields = { bench: benchId, harness: harness.metadata.id };
    const taskEventFields = (task: Task.AnyTask) => ({
      ...evalEventFields,
      task: task.metadata.id,
    });
    const trailEventFields = (task: Task.AnyTask, trailIdx: number) => ({
      ...taskEventFields(task),
      trailIdx,
    });

    yield* Effect.annotateCurrentSpan({ benchmark: benchId });
    yield* Effect.logDebug("Starting evaluation schedule");

    const startedAt = yield* DateTime.now;
    const resultRef = yield* Ref.make<BenchResult>(
      BenchResult.make({
        startedAt,
        finishedAt: startedAt,
        tasks: {},
      }),
    );

    const prepareTask = Effect.fn("exec/prepareTask")(
      function* (task: Task.AnyTask) {
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
          bench,
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
      const finishedAt = yield* DateTime.now;
      yield* Ref.update(resultRef, (result) => ({
        ...result,
        finishedAt,
      }));
      return yield* Ref.get(resultRef);
    }

    yield* Effect.logDebug(`Loaded ${tasks.length} task(s)`);

    yield* Event.InitEvent.makeEffect({
      ...evalEventFields,
      benchMetadata: Bench.metadata(bench),
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
              taskResult.startedAt = castDraft(
                DateTime.min(taskResult.startedAt, result.startedAt),
              );
              taskResult.finishedAt = castDraft(
                DateTime.max(taskResult.finishedAt, result.finishedAt),
              );
              taskResult.trails.push(castDraft(result));
            } else {
              draft.tasks[task.metadata.id] = castDraft(
                TaskResult.make({
                  startedAt: result.startedAt,
                  finishedAt: result.finishedAt,
                  trails: [castDraft(result)],
                }),
              );
            }
          }),
        ).pipe(
          Effect.andThen(
            Effect.forEach(
              benchMetrics,
              (run) =>
                run({
                  task: task.metadata.id,
                  ...result,
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
            ).pipe(Effect.mapError(EvalError.init)),
          ),
        ),
      ),
    );

    const finishedAt = yield* DateTime.now;
    yield* Ref.update(resultRef, (result) => ({
      ...result,
      finishedAt,
    }));
    yield* Effect.logDebug("Completed evaluation schedule");
    return yield* Ref.get(resultRef);
  },
  (effect, { bench }) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.metadata.id })),
);
