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
  Fiber,
  FiberSet,
  Match,
  Option,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

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

    const turns = Stream.callback<Prompt.Prompt | Response.AnyStreamPart, EvalError>((queue) =>
      Effect.gen(function* () {
        let current: Option.Option<Prompt.Prompt> = Option.some(promptInit);

        while (Option.isSome(current)) {
          const prompt = current.value;
          yield* Effect.all([Queue.offer(queue, prompt), Queue.offer(deltaQueue, prompt)]);

          const response = session
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
            );

          yield* response.pipe(
            Stream.tap((part) => Queue.offer(queue, part)),
            Response.fold,
            Stream.runForEach((part) => Queue.offer(deltaQueue, part)),
          );

          const trajectory = yield* Ref.get(session.trajectory);
          current = yield* promptFn(trajectory).pipe(Effect.mapError(EvalError.prompt));
        }

        yield* Queue.end(queue);
        yield* Queue.end(deltaQueue);
      }),
    ).pipe(Stream.ensuring(Queue.end(deltaQueue)));

    const turnEvents = turns.pipe(
      Stream.map((value) =>
        Match.value(value).pipe(
          Match.when(Prompt.isPrompt, (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
          Match.orElse((part) => Event.SessionStreamEvent.make({ id, part })),
        ),
      ),
    );

    const deltas = yield* Stream.fromQueue(deltaQueue).pipe(
      Stream.share({ capacity: "unbounded" }),
    );
    const metricEventStreams = trajMetrics
      .map(Metric.Traj.makeStream(deltas))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.SessionMetricEvent.make({ id, ...result })));
    const metricEvents = Stream.mergeAll(metricEventStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));
    const endEvent = Effect.all([Ref.get(finishRef), Ref.get(usageRef)]).pipe(
      Effect.map(([reason, usage]) => Event.SessionEndEvent.make({ id, reason, usage })),
      Stream.fromEffect,
    );

    const result = Effect.all({
      usage: Ref.get(usageRef),
      trajectory: Ref.get(session.trajectory),
    }).pipe(
      Effect.flatMap(({ usage, trajectory }) =>
        Effect.fail(Event.SessionResult.make({ usage, trajectory })),
      ),
      Stream.fromEffect,
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(turnEvents),
      Stream.merge(metricEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
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

    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const sessionResultQueue = yield* Queue.make<Event.SessionResult, Cause.Done>();
    const trailResultRef = yield* Ref.make<Option.Option<Event.TrailResult>>(Option.none());

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
      Event.EvalErrorEvent | EvalError | Event.TrailResult,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID: Event.SessionID = { ...id, sessionIdx };

      const session = makeSession<T>({ id: sessionID, task, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, agentSession),
        Stream.provide(
          Prompt.layerFrom({
            options: promptOptions,
            context: sbxPromise,
          }),
        ),
        Stream.catchTag("PromptError", (error) => Stream.fail(EvalError.prompt(error))),
        Stream.catchTag("SessionResult", (result) =>
          Effect.gen(function* () {
            yield* Ref.set(usageRef, result.usage);
            yield* Queue.offer(sessionResultQueue, result);
            return Stream.empty;
          }).pipe(Stream.unwrap),
        ),
      );

      const gradeResult = Effect.gen(function* () {
        const trajectory = yield* Ref.get(agentSession.trajectory);

        const grade = yield* runGrader<Task.GradeOf<T>>({
          sandbox: sbxSession.sandbox,
          trajectory,
        }).pipe(
          Effect.catchTag("Retry", (retry) => Effect.fail(retry)),
          Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
        );

        yield* Queue.end(sessionResultQueue);
        const sessions = yield* Queue.collect(sessionResultQueue);
        return Stream.fail(Event.TrailResult.make({ grade, sessions }));
      }).pipe(Stream.unwrap);

      const makeRetry = (retry: Grade.Retry) =>
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

      const gradeStream = gradeResult.pipe(Stream.catchTag("Retry", makeRetry));

      return Stream.empty.pipe(Stream.concat(session), Stream.concat(gradeStream));
    };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));
    const attemptEvents = makeAttempt({ agentSession, prompt: promptOptions, sessionIdx: 0 });

    const schedMetricStreams = schedMetrics
      .map(Metric.Sched.makeStream(sandbox))
      .map(Stream.mapError(EvalError.metric));
    const metricEvents = Stream.mergeAll(schedMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ id, ...result })));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(attemptEvents),
      Stream.merge(metricEvents),
      // TODO end
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TrailErrorEvent.make({ id, error })),
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

    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        id,
        taskMetrics: taskMetrics.map((metric) => metric.metadata),
        trajMetrics: trajMetrics.map((metric) => metric.metadata),
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
        task: task.metadata,
      }),
    );

    const trailQueue = yield* Queue.make<
      Event.EvalSuccessEvent,
      Event.EvalErrorEvent | Cause.Done
    >();
    const trailFibers = yield* FiberSet.make<void, never>();
    const trailResultQueues = yield* Effect.all([
      Queue.make<TrailResultEntry, Cause.Done>(),
      ...taskMetrics.map(() => Queue.make<TrailResultEntry, Cause.Done>()),
    ]);
    const trailResultQueue = trailResultQueues[0]!;
    const taskMetricQueues = trailResultQueues.slice(1);

    for (let trailIdx = 0; trailIdx < trailCount; trailIdx += 1) {
      const trailID = { ...id, trailIdx };
      yield* makeTrail<T>({ task, id: trailID })
        .pipe(
          Stream.provide(Grade.RunService.layerFrom<Task.GradeOf<T>>(grader)),
          Stream.provideService(Harness.SnapService, snapSession),
        )
        .pipe(
          Stream.catchTag("GradeError", (error) =>
            Stream.fail(Event.TrailErrorEvent.make({ id: trailID, error: EvalError.grade(error) })),
          ),
          Stream.catchTag("ResultDone", ({ value }) =>
            Effect.forEach(
              trailResultQueues,
              (queue) => Queue.offer(queue, [trailIdx, value] as const),
              { discard: true },
            ).pipe(Effect.as(Stream.empty), Stream.unwrap),
          ),
          Stream.runForEach((event) => Queue.offer(trailQueue, event)),
          Effect.catchCause((cause) => Queue.failCause(trailQueue, cause)),
          Effect.asVoid,
        )
        .pipe(trailSem.withPermit, FiberSet.run(trailFibers));
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

    const trailEvents = Stream.fromQueue(trailQueue);
    const taskMetricStreams = taskMetrics
      .map((metric, index) =>
        Metric.Task.makeStream(
          Stream.fromQueue(taskMetricQueues[index]!).pipe(Stream.map(([, result]) => result)),
        )(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const metricEvents = Stream.mergeAll(taskMetricStreams, { concurrency: "unbounded" }).pipe(
      Stream.map((result) => Event.TaskMetricEvent.make({ id, ...result })),
    );
    const activeEvents = trailEvents.pipe(Stream.merge(metricEvents));
    const result = Stream.fromEffect(
      Stream.fromQueue(trailResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) =>
            Event.resultDone(
              Event.TaskResult.make({
                trails: entries
                  .slice()
                  .sort(([left], [right]) => left - right)
                  .map(([, trail]) => trail),
              }),
            ),
          ),
        ),
    );
    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ id }));

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
        Stream.fail(Event.TaskErrorEvent.make({ id, error })),
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

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getBench(Event.BenchID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const taskResultQueues = yield* Effect.all([
      Queue.make<[Task.ID, Event.TaskResult], Cause.Done>(),
      ...metrics.map(() => Queue.make<[Task.ID, Event.TaskResult], Cause.Done>()),
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
        Stream.catchTag("ResultDone", ({ value }) =>
          Effect.forEach(
            taskResultQueues,
            (queue) => Queue.offer(queue, [task.metadata.id, value] as const),
            { discard: true },
          ).pipe(Effect.as(Stream.empty), Stream.unwrap),
        ),
      ),
    );
    const taskEvents =
      tasks.length === 0
        ? Stream.empty
        : Stream.mergeAll(taskStreams, { concurrency: tasks.length });
    const taskEventsWithClose = taskEvents.pipe(
      Stream.ensuring(
        Effect.forEach(taskResultQueues, (queue) => Queue.end(queue), { discard: true }),
      ),
    );

    const metricStreams = metrics
      .map((metric, index) =>
        Metric.Bench.makeStream(
          Stream.fromQueue(benchMetricQueues[index]!).pipe(
            Stream.map(([taskId, result]) => [taskId, result.trails] as const),
          ),
        )(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const metricEvents = Stream.mergeAll(metricStreams, { concurrency: "unbounded" }).pipe(
      Stream.map((result) => Event.BenchMetricEvent.make({ id, ...result })),
    );

    const startEvent = Stream.succeed(
      Event.BenchStartEvent.make({
        id,
        bench: bench.metadata,
        harness: harness.metadata,
        metrics: metrics.map((metric) => metric.metadata),
      }),
    );

    const endEvent = Stream.succeed(Event.BenchEndEvent.make({ id }));
    const result = Stream.fromEffect(
      Stream.fromQueue(taskResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) =>
            Event.resultDone(
              Event.BenchResult.make({
                tasks: Object.fromEntries(entries.map(([taskId, task]) => [taskId, task])),
              }),
            ),
          ),
        ),
    );
    const stream = Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(taskEventsWithClose.pipe(Stream.merge(metricEvents))),
      Stream.concat(endEvent),
      Stream.concat(result),
    );

    if (Option.isSome(persist)) {
      const persistQueue = yield* Queue.make<
        Stream.Success<typeof stream>,
        Stream.Error<typeof stream> | Cause.Done
      >();
      const persistFiber = yield* persist.value
        .persist(Stream.fromQueue(persistQueue))
        .pipe(Effect.catchTag("EventError", (error) => Effect.fail(EvalError.event(error))))
        .pipe(Effect.forkScoped);

      return stream.pipe(
        Stream.tap((event) => Queue.offer(persistQueue, event)),
        Stream.catch((error) =>
          Queue.fail(persistQueue, error).pipe(
            Effect.andThen(Fiber.join(persistFiber)),
            Effect.andThen(Effect.fail(error)),
            Stream.fromEffect,
          ),
        ),
        Stream.onEnd(Queue.end(persistQueue).pipe(Effect.andThen(Fiber.join(persistFiber)))),
      );
    }

    return stream;
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
          return yield* Effect.fail(Event.BenchErrorEvent.make({ id, error }));
        }).pipe(Stream.fromEffect),
      ),
    ),
);
