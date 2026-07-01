import { Cause, Effect, Fiber, Option, Pull, Queue, Scope, Semaphore, Stream } from "effect";
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
    void,
    ExecError,
    Agent.ProviderService | Sandbox.ProviderService | Scope.Scope
  > {
    const { snapshotConcurrency = 1, trailConcurrency = 1 } = harnessConfig ?? {};

    yield* Effect.annotateCurrentSpan({
      benchmark: metadata.name,
    });
    yield* Effect.logDebug("Starting evaluation schedule");

    const metricQueue = yield* Queue.bounded<Metric.Input, Cause.Done>(128);

    const eventQueue = yield* Queue.bounded<Event, Cause.Done>(128);
    yield* Queue.offer(eventQueue, BenchScheduleEvent.make({ bench: metadata.name, op: "start" }));

    const transport = yield* Effect.serviceOption(EventTransportService);
    yield* Option.match(transport, {
      onSome: (transport) =>
        Effect.gen(function* () {
          const stream = Stream.fromQueue(eventQueue);
          yield* transport.send({ stream });
        }).pipe(Effect.forkChild),
      onNone: () => Effect.void,
    });

    const snapshotSem = yield* Semaphore.make(snapshotConcurrency);
    const snapshotCountdown = yield* Countdown.make(tasks.length);
    const trailSem = yield* Semaphore.make(trailConcurrency);

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
        yield* Queue.offer(
          eventQueue,
          TaskScheduleEvent.make({ bench: metadata.name, task: task.metadata.name, op: "start" }),
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
        yield* Queue.offer(
          eventQueue,
          TaskScheduleEvent.make({ bench: metadata.name, task: task.metadata.name, op: "stop" }),
        );
        // wait for all trails to finish successfully
        // before leaving the task scope and cleaning up snapshots and other resources
      },
      (effect, { task }) =>
        effect
          .pipe(
            Effect.annotateLogs({
              benchmark: metadata.name,
              taskName: task.metadata.name,
            }),
          )
          // .pipe(Effect.provide(agent), Effect.provide(sandbox))
          .pipe(Effect.mapError(ExecError.taskInit({ task: task.metadata }))),
    );

    if (metrics) {
      yield* Effect.logDebug("Starting metrics stream");
      yield* Stream.fromQueue(metricQueue).pipe(
        Metric.transform({ metrics, trailCount, taskCount: tasks.length }),
        Stream.tap((output) =>
          Queue.offer(eventQueue, MetricsStreamEvent.make({ bench: metadata.name, output })),
        ),
        Stream.runDrain,
        Pull.catchDone(() => Effect.void),
        Effect.mapError(ExecError.metric),
      );
    } else {
      yield* Effect.logDebug("Skipping metrics");
    }

    yield* Effect.logDebug("Loading tasks");
    const loadedTasks = yield* Effect.all(
      tasks.map((task) => task.pipe(Effect.mapError(ExecError.taskLoad))),
      { concurrency: "unbounded" },
    );
    yield* Effect.logDebug(`Loaded ${loadedTasks.length} task(s)`);

    yield* Effect.all(
      loadedTasks.map((task) => scheduleTrail({ task })),
      { concurrency: "unbounded" },
    )
      .pipe(Effect.scoped)
      .pipe(Effect.ensuring(Queue.end(eventQueue)))
      .pipe(Effect.ensuring(Queue.end(metricQueue)));

    yield* Effect.logDebug("Scheduled all tasks");
    yield* Queue.offer(eventQueue, BenchScheduleEvent.make({ bench: metadata.name, op: "stop" }));
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
