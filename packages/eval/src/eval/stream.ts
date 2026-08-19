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
  Match,
  Option,
  Array,
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
  function* <T extends Task.AnyTask>({ id, task }: SessionOptions<T>) {
    const { trajMetrics } = task;

    const session = yield* Harness.AgentService;
    const prompting = yield* Prompt.Service;

    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const deltaQueue = yield* Queue.make<Prompt.Prompt | Response.AnyAggPart, Cause.Done>();

    const turns = Stream.callback<Prompt.Prompt | Response.AnyStreamPart, EvalError>(
      Effect.fn(
        function* (queue) {
          let current: Option.Option<Prompt.Prompt> = Option.some(prompting.init);

          while (Option.isSome(current)) {
            yield* Effect.all([
              Queue.offer(queue, current.value),
              Queue.offer(deltaQueue, current.value),
            ]);

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
            current = yield* prompting.prompt(trajectory).pipe(Effect.mapError(EvalError.prompt));
          }

          yield* Queue.end(queue);
          yield* Queue.end(deltaQueue);
        },
        (eff, queue) =>
          eff.pipe(Effect.ensuring(Effect.all([Queue.end(queue), Queue.end(deltaQueue)]))),
      ),
    );

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
        Effect.fail(Event.SessionResult.make({ id, usage, trajectory })),
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

    const grading = yield* Grade.RunService;
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
      Event.EvalErrorEvent | EvalError | Event.TrailResult<Task.GradeTypeOf<T>>,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID: Event.SessionID = { ...id, sessionIdx };

      const session = makeSession<T>({ id: sessionID, task, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, agentSession),
        Stream.provide(Prompt.layerFrom({ options: promptOptions, context: sbxPromise })),
        Stream.catchTag("PromptError", (error) => Stream.fail(EvalError.prompt(error))),
        Stream.catchTag("SessionResult", (result) =>
          Effect.all([
            Ref.set(usageRef, result.usage),
            Queue.offer(sessionResultQueue, result),
          ]).pipe(() => Stream.empty),
        ),
      );

      const gradeResult = Effect.gen(function* () {
        const trajectory = yield* Ref.get(agentSession.trajectory);

        const grade = yield* grading
          .run<Task.GradeOf<T>>({
            sandbox: sbxSession.sandbox,
            trajectory,
          })
          .pipe(Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))));

        const endEvent = Stream.succeed(Event.TrailEndEvent.make({ id, grade }));

        yield* Queue.end(sessionResultQueue);
        const sessions = yield* Queue.collect(sessionResultQueue);
        const result = Stream.fail(Event.TrailResult.make({ id, grade, sessions }));

        return Stream.empty.pipe(Stream.concat(endEvent), Stream.concat(result));
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

      const grade = gradeResult.pipe(Stream.catchTag("Retry", makeRetry));
      return Stream.empty.pipe(Stream.concat(session), Stream.concat(grade));
    };

    const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
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
      // end event and result are included in attemptEvents
      Stream.merge(metricEvents),
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

    const trailResultQueue = yield* Queue.make<Event.TrailResult, Cause.Done>();
    const trailResults = yield* Stream.fromQueue(trailResultQueue).pipe(
      Stream.share({ capacity: "unbounded" }),
    );
    const taskResultFiber = yield* Stream.runCollect(trailResults).pipe(Effect.forkScoped);

    // trails of the same task should task global trail sem sequentially
    // to ensure inter-task fairness
    const trailSchedSem = yield* Semaphore.make(1);

    const trails = Array.range(0, trailCount - 1).map(
      Effect.fn(
        function* (trailIdx) {
          yield* trailSchedSem.release(1);

          const trailID: Event.TrailID = { ...id, trailIdx };
          return makeTrail<T>({ task, id: trailID })
            .pipe(
              Stream.provide(Grade.layerFrom(grader)),
              Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
              Stream.provideService(Harness.SnapService, snapSession),
            )
            .pipe(
              Stream.catchTag("TrailResult", (result) =>
                Queue.offer(trailResultQueue, result).pipe(() => Stream.empty),
              ),
            );
        },
        (eff) => eff.pipe(trailSem.withPermit, Stream.unwrap),
      ),
    );
    const trailEvents = Stream.mergeAll(
      trails.map((trail) =>
        trail.pipe(
          Stream.onStart(
            // ensure only one trail per task is waiting trailSem
            trailSchedSem.take(1).pipe(Effect.andThen(Effect.yieldNow)),
          ),
        ),
      ),
      { concurrency: "unbounded" },
    );

    const metricStreams = taskMetrics
      .map(Metric.Task.makeStream(trailResults))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.TaskMetricEvent.make({ id, ...result })));
    const metricEvents = Stream.mergeAll(metricStreams, { concurrency: "unbounded" });
    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ id }));

    const result = Effect.gen(function* () {
      yield* Queue.end(trailResultQueue);
      const trails = yield* Fiber.join(taskResultFiber);
      return yield* Effect.fail(Event.TaskResult.make({ id, trails }));
    }).pipe(Stream.fromEffect);

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(trailEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
      Stream.merge(metricEvents),
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

    const taskResultQueue = yield* Queue.make<[Task.ID, Event.TaskResult], Cause.Done>();
    const taskResults = yield* Stream.fromQueue(taskResultQueue).pipe(
      Stream.share({ capacity: "unbounded" }),
    );
    const resultFiber = yield* Stream.runCollect(taskResults)
      .pipe(Effect.map((entries) => Object.fromEntries(entries)))
      .pipe(Effect.forkScoped);

    const taskStreams = tasks.map((task) =>
      makeTask<T>({
        id: { ...id, taskId: task.metadata.id },
        bench,
        task,
        config,
        snapSem,
        trailSem,
        trailCount,
      }).pipe(),
    );
    const taskEvents = Stream.mergeAll(taskStreams, { concurrency: "unbounded" }).pipe(
      Stream.catchTag("TaskResult", (result) =>
        Queue.offer(taskResultQueue, [result.id.taskId, result]).pipe(() => Stream.empty),
      ),
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

    let stream = yield* Stream.empty
      .pipe(Stream.concat(startEvent), Stream.concat(taskEvents), Stream.concat(endEvent))
      .pipe(Stream.share({ capacity: "unbounded" }));

    const persistFiber = yield* Effect.gen(function* () {
      if (Option.isNone(persist)) {
        return;
      }

      yield* persist.value
        .persist(stream)
        .pipe(Effect.catchTag("EventError", (error) => Effect.fail(EvalError.event(error))));
    }).pipe(Effect.forkScoped);

    const result = Effect.gen(function* () {
      yield* Queue.end(taskResultQueue);
      const tasks = yield* Fiber.join(resultFiber);

      return yield* Effect.fail(Event.BenchResult.make({ id, tasks }));
    }).pipe(Stream.fromEffect);

    return Stream.empty.pipe(
      Stream.concat(stream),
      Stream.concat(result),
      Stream.onEnd(Fiber.join(persistFiber)),
    );
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
