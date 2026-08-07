import { Array, Crypto, DateTime, Effect, Ref, Scope, Stream } from "effect";
import { castDraft, produce } from "immer";
import * as Bench from "#/bench/index.ts";
import { Harness, Snapshot } from "@open-insight/core/internal";
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

type SnapshotGroup = Readonly<{
  hash: string;
  snapshot: Snapshot.Template;
  tasks: ReadonlyArray<Task.AnyTask>;
}>;

type Options = Readonly<{
  bench: Bench.Bench;
  eventQueue: Event.EventEnqueue;
}>;

export const run = Effect.fn("exec/schedule")(
  function* (
    { bench, eventQueue }: Options,
    config: Config,
  ): Effect.fn.Return<BenchResult, EvalError, Crypto.Crypto | Scope.Scope | Harness.Service> {
    const { snapshotConcurrency, taskConcurrency, trailConcurrency } = config;
    const offer = Event.offerTo(eventQueue);

    const harness = yield* Harness.Service;
    const { tasks } = bench;

    const benchId = bench.metadata.id;
    const harnessId = harness.metadata.id;
    const evalEventFields = { bench: benchId, harness: harnessId };
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
      function* (task: Task.AnyTask, snapshotSession: Harness.SnapshotSession) {
        yield* Effect.annotateCurrentSpan({
          benchmark: benchId,
          taskName: task.metadata.name,
          trailCount: config.trailCount,
        });
        yield* Effect.logDebug("Preparing task");

        yield* Event.TaskScheduleEvent.makeEffect({
          ...taskEventFields(task),
          op: "start",
        }).pipe(offer);

        const runTrail = yield* createTrail({
          benchId,
          harnessId,
          task,
          eventQueue,
          config,
          snapshotSession,
        });

        yield* Effect.logDebug("Prepared task");
        return { task, runTrail };
      },
      (effect, task, _run) =>
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

    yield* Event.EvalScheduleEvent.makeEffect({
      ...evalEventFields,
      op: "start",
    }).pipe(offer);

    const result = yield* Effect.gen(function* () {
      const hashed = yield* Effect.forEach(
        tasks,
        Effect.fn(function* (task) {
          const hash = yield* Snapshot.hash(task.snapshot).pipe(
            Effect.mapError(EvalError.snapshot(task)),
          );
          return { hash, task } satisfies Readonly<{ hash: string; task: Task.AnyTask }>;
        }),
        { concurrency: "unbounded" },
      );

      // group snapshots by hash to dedup
      // same snapshot should only be built once
      const groups: ReadonlyArray<SnapshotGroup> = Object.values(
        Array.groupBy(hashed, ({ hash }) => hash),
      ).map((entries) => {
        const [first] = entries;
        return {
          hash: first.hash,
          snapshot: first.task.snapshot,
          tasks: entries.map(({ task }) => task),
        };
      });

      const prepare = Effect.fn(
        function* ({ hash, snapshot, tasks }: SnapshotGroup) {
          yield* Effect.annotateCurrentSpan({ benchmark: benchId, snapshot: hash });
          yield* Effect.logDebug("Preparing snapshot");

          const snapshotSession = yield* harness
            .runSnapshot(snapshot, config)
            .pipe(Effect.mapError(EvalError.harness));

          yield* Effect.logDebug("Prepared snapshot");

          return yield* Effect.all(
            tasks.map((task) => prepareTask(task, snapshotSession)),
            { concurrency: taskConcurrency },
          );
        },
        (effect, { hash }) =>
          effect.pipe(Effect.annotateLogs({ benchmark: benchId, snapshot: hash })),
      );

      const scheduledGroups = yield* Effect.forEach(groups, prepare, {
        concurrency: snapshotConcurrency,
      });
      const scheduleds = scheduledGroups.flat();
      yield* Effect.logDebug(`Prepared ${scheduleds.length} task(s)`);

      const completedTrails = makeTrailStream(scheduleds).pipe(
        Stream.mapEffect(runScheduledTrail, {
          concurrency: trailConcurrency,
          unordered: true,
        }),
      );

      const benchMetrics = yield* Effect.forEach(bench.metrics, Metric.Bench.run);
      yield* completedTrails.pipe(
        Stream.runForEach(({ task, result }) =>
          Ref.modify(resultRef, (benchResult) => {
            const taskResult = benchResult.tasks[task.metadata.id];
            const completedTrailCount = (taskResult?.trails.length ?? 0) + 1;
            const updatedBenchResult = produce(benchResult, (draft) => {
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
            });

            return [
              completedTrailCount === config.trailCount,
              updatedBenchResult,
            ] satisfies readonly [boolean, BenchResult];
          }).pipe(
            Effect.flatMap((taskFinished) =>
              taskFinished
                ? Event.TaskScheduleEvent.makeEffect({
                    ...taskEventFields(task),
                    op: "stop",
                  }).pipe(offer)
                : Effect.void,
            ),
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
    }).pipe(
      Effect.ensuring(
        Event.EvalScheduleEvent.makeEffect({
          ...evalEventFields,
          op: "stop",
        }).pipe(offer),
      ),
    );

    return result;
  },
  (effect, { bench }) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.metadata.id })),
);
