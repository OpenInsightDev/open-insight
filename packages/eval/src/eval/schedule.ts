import { Effect, FileSystem, Path, Queue, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import { BenchScheduleEvent, type Event, InitEvent, TrailScheduleEvent } from "./event/index.ts";
import { createTrail, type RunTrail } from "./trail.ts";

type ScheduledTask = Readonly<{
  task: Task.Task;
  runTrail: RunTrail;
}>;

type ScheduledTrail = ScheduledTask &
  Readonly<{
    trailIndex: number;
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

    yield* Effect.annotateCurrentSpan({ benchmark: bench.name });
    yield* Effect.logDebug("Starting evaluation schedule");

    const prepareTask = Effect.fn("exec/prepareTask")(
      function* (task: Task.Task) {
        yield* Effect.annotateCurrentSpan({
          benchmark: bench.name,
          taskName: task.metadata.name,
          trailCount,
        });
        yield* Effect.logDebug("Preparing task");

        const runTrail = yield* createTrail({
          task,
          bench: bench.name,
          harness: harness.name,
          eventQueue,
          config,
        });

        yield* Effect.logDebug("Prepared task");
        return { task, runTrail };
      },
      (effect, task) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: bench.name,
            taskName: task.metadata.name,
          }),
        ),
    );

    const runScheduledTrail = Effect.fn("exec/runScheduledTrail")(
      function* ({ task, runTrail, trailIndex }: ScheduledTrail) {
        yield* Effect.annotateCurrentSpan({
          benchmark: bench.name,
          taskName: task.metadata.name,
          trailIndex,
          trailCount,
        });

        yield* offerEvent(
          TrailScheduleEvent.make({
            bench: bench.name,
            harness: harness.name,
            task: task.metadata.name,
            trailIndex,
            op: "start",
          }),
        );

        yield* runTrail;

        yield* offerEvent(
          TrailScheduleEvent.make({
            bench: bench.name,
            harness: harness.name,
            task: task.metadata.name,
            trailIndex,
            op: "stop",
          }),
        );
      },
      (effect, { task }) =>
        effect.pipe(
          Effect.annotateLogs({
            benchmark: bench.name,
            taskName: task.metadata.name,
          }),
        ),
    );

    const makeTrailStream = (scheduledTasks: ReadonlyArray<ScheduledTask>) =>
      Stream.range(0, trailCount - 1).pipe(
        Stream.flatMap((trailIndex) =>
          Stream.fromIterable(scheduledTasks).pipe(
            Stream.map((scheduledTask): ScheduledTrail => ({ ...scheduledTask, trailIndex })),
          ),
        ),
      );

    yield* Effect.logDebug("Loading tasks");
    const tasks = yield* Effect.all(
      bench.tasks.map((task) => task.pipe(Effect.mapError(Error.tasks))),
      { concurrency: "unbounded" },
    );

    if (tasks.length === 0) {
      yield* Effect.logWarning("No tasks to schedule");
      return;
    }

    yield* Effect.logDebug(`Loaded ${tasks.length} task(s)`);
    yield* offerEvent(
      InitEvent.make({
        bench,
        harness,
        tasks: tasks.map(({ metadata }) => metadata),
        metrics: [],
      }),
    );
    yield* offerEvent(
      BenchScheduleEvent.make({
        bench: bench.name,
        harness: harness.name,
        op: "start",
      }),
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

    yield* offerEvent(
      BenchScheduleEvent.make({
        bench: bench.name,
        harness: harness.name,
        op: "stop",
      }),
    );

    yield* Effect.logDebug("Completed evaluation schedule");
  },
  (effect, { bench }) => effect.pipe(Effect.scoped, Effect.annotateLogs({ benchmark: bench.name })),
);
