import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "@open-insight/core/internal";
import {
  Effect,
  FileSystem,
  Path,
  Ref,
  Semaphore,
  Stream,
  Cause,
  Queue,
  FiberSet,
  Fiber,
  Match,
  Option,
  pipe,
  Data,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { SandboxExposeError } from "../../../core/src/sandbox/error.ts";

type SessionOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.SessionID;

  task: T;
  sbxPromise: Sandbox.SandboxPromise;
}>;

const makeSession = Effect.fn(
  function* <T extends Task.AnyTask>(options: SessionOptions<T>) {
    const { id, task } = options;
    const { trajMetrics } = task;

    const session = yield* Harness.AgentService;
    const { init: promptInit, prompt: promptFn } = yield* Prompt.Service;

    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const deltaQueue = yield* Queue.make<Prompt.Prompt | Response.AnyAggPart, Cause.Done>();

    const turns = Stream.callback<Prompt.Prompt | Response.AnyStreamPart, EvalError>(
      Effect.fn(function* (queue) {
        let current: Option.Option<Prompt.Prompt> = Option.some(promptInit);

        while (Option.isSome(current)) {
          yield* Effect.all([
            Queue.offer(queue, current.value),
            Queue.offer(deltaQueue, current.value),
          ]);

          const [resp, respForDelta] = yield* session
            .prompt(current.value)
            .pipe(Stream.mapError(EvalError.harness))
            .pipe(
              Stream.tap(
                Effect.fn(function* (part) {
                  if (part.type !== "finish") {
                    return;
                  }
                  yield* Effect.all([
                    Ref.set(finishRef, part.reason),
                    Ref.set(usageRef, part.usage),
                  ]);
                }),
              ),
            )
            .pipe(Stream.broadcastN({ n: 2, capacity: "unbounded" }));

          yield* Effect.all([
            resp.pipe(Stream.runForEach((part) => Queue.offer(queue, part))),
            respForDelta
              .pipe(Response.fold)
              .pipe(Stream.runForEach((part) => Queue.offer(deltaQueue, part))),
          ]);

          const trajectory = yield* Ref.get(session.trajectory);

          current = yield* promptFn(trajectory).pipe(Effect.mapError(EvalError.prompt));
        }

        yield* Queue.end(queue);
      }),
    );
    const turnEvents = turns.pipe(
      Stream.map((value) =>
        Match.value(value).pipe(
          Match.when(Prompt.isPrompt, (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
          Match.orElse((part) => Event.SessionStreamEvent.make({ id, part })),
        ),
      ),
    );

    const deltas = Stream.fromQueue(deltaQueue);
    const metricEventStreams = trajMetrics
      .map((metric) => Metric.Traj.makeStream({ stream: deltas })(metric))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(
        Stream.map(({ metricID: metricID, ...values }) =>
          Event.SessionMetricEvent.make({ id: { ...id, id: metricID }, ...values }),
        ),
      );
    const metricEvents = Stream.mergeAll(metricEventStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));
    const endEvent = Effect.all([Ref.get(finishRef), Ref.get(usageRef)]).pipe(
      Effect.map(([reason, usage]) => Event.SessionEndEvent.make({ id, reason, usage })),
      Stream.fromEffect,
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(turnEvents),
      Stream.concat(endEvent),
      Stream.merge(metricEvents),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.SessionErrorEvent.make({ id, error })),
      ),
    ),
);

type TrailOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.TrailID;
  task: T;
}>;

const makeTrail = Effect.fn(
  function* <T extends Task.AnyTask>({ id, task }: TrailOptions<T>) {
    const { sandboxConfig, schedMetrics, prompt: promptOptions } = task;

    const { run: runGrader } = yield* Grade.RunService;
    const snapSession = yield* Harness.SnapService;

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getTrail(Event.TrailID.make(id));
      if (Option.isSome(stream)) {
        yield* Effect.logInfo(
          `Trail ${id.trailIdx} for task ${id.taskId} already exists in persist, skipping execution`,
        );
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const sbxSession = yield* snapSession
      .runSandbox(sandboxConfig)
      .pipe(Effect.mapError(EvalError.harness));
    const sandbox = sbxSession.sandbox;
    const sbxPromise = yield* Sandbox.asPromise(sbxSession.sandbox);

    const makeAttempt = ({
      agentSession,
      prompt: promptOptions,
      sessionIdx,
    }: {
      agentSession: Harness.AgentSession;
      prompt: Prompt.Options;
      sessionIdx: number;
    }): Stream.Stream<
      Event.EvalSuccessEvent,
      Event.EvalErrorEvent | EvalError,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID = { ...id, sessionIdx };

      const promptingLayer = Prompt.layerFrom({
        options: promptOptions,
        context: sbxPromise,
      });

      const sessionStream = makeSession<T>({ id: sessionID, task, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, agentSession),
        Stream.provide(promptingLayer),
        Stream.catchTag("PromptError", (error) => Stream.fail(EvalError.prompt(error))),
      );

      const gradeResultStream = Effect.gen(function* () {
        const trajectory = yield* Ref.get(agentSession.trajectory);

        const grade = yield* runGrader<Task.GradeOf<T>>({
          sandbox: sbxSession.sandbox,
          trajectory,
        }).pipe(
          Effect.catchTag("Retry", (retry) => Effect.fail(retry)),
          Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
        );

        return Stream.succeed(Event.TrailEndEvent.make({ id, grade }));
      }).pipe(Stream.unwrap);

      const makeRetryStream = (retry: Grade.Retry) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `Grader requested a "${retry.type}" retry for trail ${id.trailIdx}: ${retry.reason ?? "unknown reason"}`,
          );

          const nextSession = yield* Match.value(retry.type).pipe(
            Match.when("restart", () =>
              sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness)),
            ),
            Match.when("continue", () => Effect.succeed(agentSession)),
            Match.exhaustive,
          );
          const nextAttempt = makeAttempt({
            agentSession: nextSession,
            prompt: { init: retry.prompt },
            sessionIdx: sessionIdx + 1,
          });

          const retryEvent = Stream.succeed(
            Event.SessionRetryEvent.make({ id: sessionID, reason: retry.reason }),
          );

          return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
        }).pipe(Stream.unwrap);

      const gradeStream = gradeResultStream.pipe(Stream.catchTag("Retry", makeRetryStream));

      return Stream.empty.pipe(Stream.concat(sessionStream), Stream.concat(gradeStream));
    };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));
    const attemptEvents = makeAttempt({ agentSession, prompt: promptOptions, sessionIdx: 0 });

    const schedMetricStreams = schedMetrics
      .map(Metric.Sched.makeStream({ sandbox }))
      .map(Stream.mapError(EvalError.metric));
    const schedMetricEvents = Stream.mergeAll(schedMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ id, ...result })));

    const activeEvents = attemptEvents.pipe(
      Stream.merge(schedMetricEvents, { haltStrategy: "left" }),
    );
    const completion = Effect.gen(function* () {
      const endEvent = Stream.succeed(Event.TrailEndEvent.make({ id, grade: result.grade }));
      return Stream.empty.pipe(Stream.concat(endEvent));
    }).pipe(Stream.unwrap);

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(completion),
    );
  },
  (eff, { id }) =>
    eff
      .pipe(Stream.unwrap)
      .pipe(
        Stream.catchTag("EvalError", (error) =>
          Stream.fail(Event.TrailErrorEvent.make({ ...id, error })),
        ),
      ),
);

export type TaskOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.TaskID;

  task: T;
  bench: Bench.Bench<T>;
  config: Config;
  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;

const makeTask = Effect.fn(
  function* <T extends Task.AnyTask>(options: TaskOptions<T>) {
    const harness = yield* Harness.Service;

    const { id, task, snapSem, trailSem, trailCount } = options;
    const {
      grader,
      snapshot: taskTemplate,
      metrics: taskMetrics,
      trajMetrics,
      schedMetrics,
    } = task;

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getTask(Event.TaskID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const runGrader = Grade.RunService.layerFrom<Task.GradeOf<T>>(grader);

    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        ...id,
        metrics: taskMetrics.map((metric) => metric.metadata),
        trajMetrics: trajMetrics.map((metric) => metric.metadata),
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
        task: task.metadata,
      }),
    );

    const trailQueue = yield* Queue.make<
      Event.EvalSuccessEvent,
      EvalError | Event.EvalErrorEvent | Cause.Done
    >();
    const trailFibers = yield* FiberSet.make<void, never>();

    // Each consumer gets its own queue. This keeps result fan-out lossless even
    // when a metric starts after a trail has completed, and lets every consumer
    // drain buffered results before the queue is ended.
    const trailResultQueues = yield* Effect.all([
      Queue.make<TrailResultEntry, Cause.Done>(),
      ...taskMetrics.map(() => Queue.make<TrailResultEntry, Cause.Done>()),
    ]);
    const trailResultQueue = trailResultQueues[0]!;
    const taskMetricQueues = trailResultQueues.slice(1);

    for (let trailIdx = 0; trailIdx < trailCount; trailIdx += 1) {
      const trailID = { ...id, trailIdx };
      yield* makeTrail<T>({ task, id: trailID })
        .pipe(Stream.provide(runGrader), Stream.provideService(Harness.SnapService, snapSession))
        .pipe(
          Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
          Stream.catchTag("ResultDone", ({ value: result }) =>
            Effect.forEach(
              trailResultQueues,
              (queue) => Queue.offer(queue, [trailID.trailIdx, result] as const),
              { discard: true },
            ).pipe(Effect.as(Stream.empty), Stream.unwrap),
          ),
        )
        .pipe(
          // `runIntoQueue` ends its queue whenever this stream completes. Trails
          // share one queue, so offer manually and close it once all fibers finish.
          Stream.runForEach((event) => Queue.offer(trailQueue, event)),
          Effect.catchCause((cause) => Queue.failCause(trailQueue, cause)),
          Effect.asVoid,
        )
        .pipe(trailSem.withPermit)
        .pipe(FiberSet.run(trailFibers));

      // ensure fair scheduling over trails of all tasks
      yield* Effect.yieldNow;
    }

    yield* Effect.forkScoped(
      FiberSet.awaitEmpty(trailFibers).pipe(
        Effect.andThen(Queue.end(trailQueue)),
        Effect.andThen(
          Effect.forEach(trailResultQueues, (queue) => Queue.end(queue), { discard: true }),
        ),
      ),
      { startImmediately: true },
    );

    const endEvent = Stream.succeed(Event.TaskEndEvent.make(id));

    const result = Stream.fromEffect(
      Stream.fromQueue(trailResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) => {
            const trails = entries
              .slice()
              .sort(([left], [right]) => left - right)
              .map(([, trail]) => trail);
            return Event.resultDone(Event.TaskResult.make({ trails }));
          }),
        ),
    );

    const trailEvents = Stream.fromQueue(trailQueue);

    const taskMetricStreams = taskMetrics
      .map((metric, index) =>
        Metric.Task.makeStream(
          Stream.fromQueue(taskMetricQueues[index]!).pipe(Stream.map(([, result]) => result)),
        )(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const taskMetricEvents = Stream.mergeAll(taskMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TaskMetricEvent.make({ ...id, ...result })));

    const activeEvents = trailEvents.pipe(Stream.merge(taskMetricEvents));
    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TaskErrorEvent.make({ ...id, error })),
      ),
    ),
);

export const make = Effect.fn(
  function* <T extends Task.AnyTask>(bench: Bench.Bench<T>, config: Config) {
    const { tasks, metrics } = bench;
    const { trailConcurrency, snapshotConcurrency, trailCount } = config;

    const invalidConcurrency = [
      { name: "trailConcurrency", value: trailConcurrency },
      { name: "snapshotConcurrency", value: snapshotConcurrency },
    ].find(({ value }) => !Number.isSafeInteger(value) || value < 1);
    if (invalidConcurrency !== undefined) {
      const { name, value } = invalidConcurrency;
      return yield* Effect.fail(
        EvalError.init(new RangeError(`${name} must be a positive integer (received ${value})`)),
      );
    }
    if (!Number.isSafeInteger(trailCount)) {
      return yield* Effect.fail(
        EvalError.init(new RangeError(`trailCount must be an integer (received ${trailCount})`)),
      );
    }

    const harness = yield* Harness.Service;
    const id: Event.BenchID = {
      harnessId: harness.metadata.id,
      benchId: bench.metadata.id,
    };

    const trailSem = yield* Semaphore.make(trailConcurrency);
    const snapSem = yield* Semaphore.make(snapshotConcurrency);

    // Fan out each completed task to an independent collector/metric queue.
    // Unbounded queues retain values for consumers that are started later and
    // explicit end signals allow partial results when a task fails.
    const taskResultQueues = yield* Effect.all([
      Queue.make<[Task.ID, Metric.Task.TrailResults], Cause.Done>(),
      ...metrics.map(() => Queue.make<[Task.ID, Metric.Task.TrailResults], Cause.Done>()),
    ]);
    const taskResultQueue = taskResultQueues[0]!;
    const benchMetricQueues = taskResultQueues.slice(1);

    const taskStreams = tasks.map((task) =>
      makeTask<T>({
        id: { ...id, taskId: task.metadata.id },
        bench,
        task,
        config,
        snapSem,
        trailSem,
        trailCount,
      }).pipe(
        Stream.catchTag("ResultDone", ({ value: result }) =>
          Effect.forEach(
            taskResultQueues,
            (queue) => Queue.offer(queue, [task.metadata.id, result.trails] as const),
            { discard: true },
          ).pipe(Effect.as(Stream.empty), Stream.unwrap),
        ),
      ),
    );
    const mergedTaskEvents =
      tasks.length === 0
        ? Stream.empty
        : Stream.mergeAll(taskStreams, { concurrency: tasks.length });

    // End all task-result consumers only after every task stream has finished.
    // Values already queued remain available to consumers before completion.
    const mergedTaskEventsWithClose = mergedTaskEvents.pipe(
      Stream.ensuring(
        Effect.forEach(taskResultQueues, (queue) => Queue.end(queue), { discard: true }),
      ),
    );

    const persist = yield* Effect.serviceOption(Event.Persist.Service);

    if (Option.isSome(persist)) {
      const stream = persist.value.getBench(Event.BenchID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const startEvent = Stream.succeed(
      Event.BenchStartEvent.make({
        ...id,
        bench: bench.metadata,
        harness: harness.metadata,
        metrics: metrics.map((metric) => metric.metadata),
      }),
    );

    const endEvent = Stream.succeed(Event.BenchEndEvent.make(id));

    const result = Stream.fromEffect(
      Stream.fromQueue(taskResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) => {
            const tasks = pipe(
              entries.map(
                ([taskId, trails]) => [taskId, Event.TaskResult.make({ trails })] as const,
              ),
              Object.fromEntries<Event.TaskResult>,
            );
            return Event.resultDone(Event.BenchResult.make({ tasks }));
          }),
        ),
    );

    const benchMetricStreams = metrics
      .map((metric, index) =>
        Metric.Bench.makeStream(Stream.fromQueue(benchMetricQueues[index]!))(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const benchMetricEvents = Stream.mergeAll(benchMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.BenchMetricEvent.make({ ...id, ...result })));

    const activeEvents = mergedTaskEventsWithClose.pipe(Stream.merge(benchMetricEvents));
    const stream = Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
    );

    if (Option.isSome(persist)) {
      const persistQueue = yield* Queue.make<
        Stream.Success<typeof stream>,
        Stream.Error<typeof stream> | Cause.Done
      >();
      const persistStream = Stream.fromQueue(persistQueue);

      const fiber = yield* persist.value
        .persist(persistStream)
        .pipe(Effect.catchTag("EventError", (error) => Effect.fail(EvalError.event(error))))
        .pipe(Effect.forkScoped);

      // Tee events through an independent queue so the main stream can signal
      // termination before joining the sink. This avoids circular waits between
      // two broadcast subscribers on failure-channel terminal signals.
      return stream.pipe(
        Stream.tap((event) => Queue.offer(persistQueue, event)),
        Stream.catch((error) =>
          Queue.fail(persistQueue, error).pipe(
            Effect.andThen(Fiber.join(fiber)),
            Effect.andThen(Effect.fail(error)),
            Stream.fromEffect,
          ),
        ),
        Stream.onEnd(Queue.end(persistQueue).pipe(Effect.andThen(Fiber.join(fiber)))),
      );
    } else {
      return stream;
    }
  },
  (eff, bench) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Effect.gen(function* () {
          const harness = yield* Harness.Service;
          const id: Event.BenchID = {
            harnessId: harness.metadata.id,
            benchId: bench.metadata.id,
          };
          return yield* Effect.fail(Event.BenchErrorEvent.make({ ...id, error }));
        }).pipe(Stream.fromEffect),
      ),
    ),
);
