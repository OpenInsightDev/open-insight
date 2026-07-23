import { Effect, FileSystem, Path, Queue, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import {
  EvalScheduleEvent,
  type Event,
  InitEvent,
  TaskScheduleEvent,
  TrailScheduleEvent,
} from "./event/index.ts";
import { createTrail, type RunTrail } from "./trail.ts";

type ScheduledTask = Readonly<{
  task: Task.Task;
  runTrail: RunTrail;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIdx: number;
  }>;

export const run = Effect.fn("exec/schedule")(
  function* (
    {
      trailCount,
      bench,
      harness,
      eventQueue,
    }: Readonly<{
      trailCount: number;
      bench: Bench.Bench;
      harness: Harness.Metadata;
      eventQueue: Queue.Enqueue<Event>;
    }>,
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
    const harnessId = harness.id;
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

        yield* Effect.acquireUseRelease(
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
        harnessMetadata: harness,
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

    yield* makeTrailStream(scheduledTasks).pipe(
      Stream.mapEffect(runScheduledTrail, {
        concurrency: trailConcurrency,
        unordered: true,
      }),
      Stream.runDrain,
    );

    yield* Effect.logDebug("Completed evaluation schedule");
  },
  (effect, { bench }) =>
    effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.metadata.id })),
);
