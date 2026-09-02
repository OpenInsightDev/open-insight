import {
  Cause,
  Effect,
  FileSystem,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Crypto,
  Stream,
  Array,
  Scope,
  flow,
  Deferred,
} from "effect";
import * as Grade from "#/grade/index.ts";
import { Toolkit } from "effect/unstable/ai";
import { type Any } from "./eval.ts";
import * as Task from "#/task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import { Harness, Prompt, Sandbox, Response, Trajectory } from "@open-insight/core/internal";
import { EvalError } from "./error.ts";
import * as Config from "./config.ts";
import type { BenchOf } from "./eval.ts";

type SessionOptions = Readonly<{
  id: Event.SessionID;
  promptSession: Prompt.Session.Session;
  sandbox: Sandbox.Sandbox;
  agentSession: Harness.AgentSession;
}>;
const makeSession = Effect.fn(
  function* ({ id, sandbox, promptSession, agentSession }: SessionOptions) {
    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const decodePart = Schema.decodeSync(Response.StreamPart(Toolkit.empty));

    const session = yield* Stream.callback<Trajectory.SessionTurn<any, EvalError>, EvalError>(
      Effect.fn(function* (queue) {
        let current: Option.Option<Prompt.Prompt> = Option.some(promptSession.init);

        while (Option.isSome(current)) {
          const trajDeferred = yield* Deferred.make<Prompt.Prompt>();

          const response = yield* agentSession
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
            .pipe(
              Stream.onEnd(
                Ref.get(agentSession.trajectory).pipe(
                  Effect.flatMap((traj) => Deferred.succeed(trajDeferred, traj)),
                ),
              ),
            )
            .pipe(Stream.share({ capacity: "unbounded" }));

          yield* Queue.offer(queue, { prompt: current.value, response });

          current = yield* Deferred.await(trajDeferred).pipe(
            Effect.flatMap((traj) =>
              promptSession
                .next(traj)
                .pipe(
                  Effect.provideService(Sandbox.Current, sandbox),
                  Effect.mapError(EvalError.prompt),
                ),
            ),
          );
        }
      }),
    ).pipe(Stream.share({ capacity: "unbounded" }));

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));

    const sessionEvents = session.pipe(
      Stream.flatMap(({ prompt, response }) =>
        Stream.empty.pipe(
          Stream.concat(Stream.succeed(Event.SessionPromptEvent.make({ id, prompt }))),
          Stream.concat(
            response.pipe(Stream.map((part) => Event.SessionStreamEvent.make({ id, part }))),
          ),
        ),
      ),
    );

    const endEvent = Effect.all([Ref.get(finishRef), Ref.get(usageRef)]).pipe(
      Effect.map(([reason, usage]) => Event.SessionEndEvent.make({ id, reason, usage })),
      Stream.fromEffect,
    );

    const trajectory = yield* Trajectory.fromSession(session, Toolkit.empty);

    const result = Ref.get(usageRef).pipe(
      Effect.flatMap((usage) => Effect.fail(new Task.Result.SessionResult({ usage, trajectory }))),
      Stream.fromEffect,
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(sessionEvents),
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

type TrailOptions = Readonly<{
  id: Event.TrailID;
  task: Task.Any;
  snapSession: Harness.SnapshotSession;
}>;

const makeTrail = Effect.fn(
  function* ({ id, task, snapSession }: TrailOptions) {
    const { resources, prompt } = task;

    const sbxSession = yield* snapSession
      .runSandbox({ resources })
      .pipe(Effect.mapError(EvalError.harness));
    const sandbox = sbxSession.sandbox;

    const gradeProvider = yield* Grade.Service;
    const gradeSession = yield* gradeProvider
      .runSession(sandbox)
      .pipe(Effect.mapError(EvalError.grade));

    const promptSession = yield* prompt.runSession(sandbox).pipe(Effect.mapError(EvalError.prompt));

    const sessionResultQueue = yield* Queue.make<Task.Result.SessionResult, Cause.Done>();

    const makeAttempt = ({
      promptSession,
      agentSession,
      sessionIdx,
    }: {
      promptSession: Prompt.Session.Session;
      agentSession: Harness.AgentSession;
      sessionIdx: number;
    }): Stream.Stream<
      Event.TrailSuccessEvent,
      Event.TrailFailedEvent | Task.Result.TrailResult<any> | EvalError,
      FileSystem.FileSystem | Path.Path | Crypto.Crypto
    > =>
      Effect.gen(function* () {
        const sessionID: Event.SessionID = { ...id, sessionIdx };

        const session = makeSession({
          id: sessionID,
          promptSession,
          agentSession,
          sandbox,
        }).pipe(
          Stream.catchTag("SessionResult", (result) =>
            Stream.empty.pipe(Stream.onStart(Queue.offer(sessionResultQueue, result))),
          ),
        );

        const gradeResult = Effect.gen(function* () {
          const grade = yield* gradeSession.pipe(
            Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
          );

          const endEvent = Stream.succeed(Event.TrailEndEvent.make({ id, grade }));

          yield* Queue.end(sessionResultQueue);
          const sessions = yield* Queue.collect(sessionResultQueue);
          const result = Stream.fail(new Task.Result.TrailResult({ grade, sessions }));

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
              promptSession,
              agentSession: nextSession,
              sessionIdx: sessionIdx + 1,
            });

            const retryEvent = Stream.succeed(
              Event.SessionRetryEvent.make({ id: sessionID, reason: retry.reason }),
            );

            return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
          }).pipe(Stream.unwrap);

        const grade = gradeResult.pipe(Stream.catchTag("Retry", makeRetry));
        return Stream.empty.pipe(Stream.concat(session), Stream.concat(grade));
      }).pipe(Stream.unwrap);

    const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const attemptEvents = makeAttempt({ promptSession, agentSession, sessionIdx: 0 });

    return Stream.empty.pipe(Stream.concat(startEvent), Stream.concat(attemptEvents));
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TrailErrorEvent.make({ id, error })),
      ),
    ),
);

type TaskOptions = Readonly<{
  id: Event.TaskID;

  task: Task.Any;
  harness: Harness.Any;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;
const makeTask = Effect.fn(
  function* (
    options: TaskOptions,
  ): Effect.fn.Return<
    Stream.Stream<
      Event.TaskSuccessEvent,
      Event.TaskFailedEvent | Task.Result.TaskResult | EvalError,
      FileSystem.FileSystem | Path.Path | Crypto.Crypto
    >,
    EvalError,
    Sandbox.ProviderService | Scope.Scope
  > {
    const { id, task, harness, snapSem, trailSem, trailCount } = options;
    const { grader, snapshot: taskTemplate } = task;

    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        id,
        task: task.metadata,
        extra: Task.Extra.extraOf(task),
      }),
    );

    const trailResultQueue = yield* Queue.make<Task.Result.TrailResult<any>, Cause.Done>();

    const trailSchedMutex = yield* Semaphore.make(1);
    const trails = Array.range(0, trailCount - 1).map(
      Effect.fn(
        function* (trailIdx) {
          // once aquired trailSem, release mutex to allow siblings to start waiting
          yield* trailSchedMutex.release(1);

          const trailID: Event.TrailID = { ...id, trailIdx };
          return makeTrail({ id: trailID, snapSession, task })
            .pipe(
              Stream.provide(Grade.layerFrom(grader)),
              Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
            )
            .pipe(
              Stream.catchTag("TrailResult", (result) =>
                Queue.offer(trailResultQueue, result).pipe(Stream.fromEffect, Stream.drain),
              ),
            );
        },
        flow(trailSem.withPermit, Stream.unwrap),
      ),
    );

    const sbxProvider = yield* Sandbox.ProviderService;
    const trailEvents = Stream.mergeAll(
      trails.map((trail) =>
        trail.pipe(
          Stream.onStart(
            // one trail at a time per task is waiting trailSem to ensure inter-task fairness
            trailSchedMutex.take(1).pipe(Effect.andThen(Effect.yieldNow)),
          ),
        ),
      ),
      { concurrency: "unbounded" },
    ).pipe(Stream.provideService(Sandbox.ProviderService, sbxProvider));

    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ id }));

    const result = Task.Result.aggregatorOf(task as any).pipe(
      Option.match({
        onSome: (agg) =>
          Queue.end(trailResultQueue)
            .pipe(Effect.andThen(Queue.collect(trailResultQueue)))
            .pipe(Effect.flatMap(agg), Effect.mapError(EvalError.task))
            .pipe(Effect.flatMap(Effect.fail), Stream.fromEffect),
        onNone: () => Stream.empty,
      }),
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(trailEvents),
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

type EvalOptions<B extends Bench.Any> = Readonly<{
  bench: B;
  harness: Harness.Any;
  config?: Partial<Config.Config>;
}>;
export const make = Effect.fn(
  function* <B extends Bench.Any>({
    bench,
    harness,
    config: configOptions,
  }: EvalOptions<B>): Effect.fn.Return<
    Stream.Stream<
      Event.EvalSuccessEvent,
      Event.EvalFailedEvent | Bench.Result.BenchResult | EvalError
    >,
    EvalError,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto | Sandbox.ProviderService | Scope.Scope
  > {
    const { tasks } = bench;

    const id: Event.EvalID = {
      harnessID: harness.metadata.id,
      benchID: bench.metadata.id,
    };

    const config = Config.make(configOptions);
    const { trailConcurrency, snapshotConcurrency, trailCount } = config;

    const trailSem = yield* Semaphore.make(trailConcurrency);
    const snapSem = yield* Semaphore.make(snapshotConcurrency);

    const taskResultQueue = yield* Queue.make<[string, Task.Result.TaskResult], Cause.Done>();

    const taskStreams = Object.entries(tasks).map(([taskID, task]) =>
      makeTask({
        id: { benchID: bench.id, harnessID: harness.id, taskID },
        task,
        harness,
        snapSem,
        trailSem,
        trailCount,
      }).pipe(
        Stream.catchTag("TaskResult", (result) =>
          Stream.empty.pipe(Stream.onStart(Queue.offer(taskResultQueue, [result.id, result]))),
        ),
      ),
    );
    const taskEvents = Stream.mergeAll(taskStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(
      Event.EvalStartEvent.make({ id, bench: bench.metadata, harness: harness.metadata }),
    );

    const endEvent = Stream.succeed(Event.EvalEndEvent.make({ id }));

    const result = Bench.Result.aggregatorOf(bench).pipe(
      Option.match({
        onSome: (agg) =>
          Queue.end(taskResultQueue).pipe(
            Effect.andThen(Queue.collect(taskResultQueue)),
            Effect.flatMap((taskResults) =>
              agg(Object.fromEntries(taskResults)).pipe(
                Effect.mapError(EvalError.bench),
                Effect.flatMap((result) => Effect.fail(result)),
              ),
            ),
            Stream.fromEffect,
          ),
        onNone: () => Stream.empty,
      }),
    );

    const stream = yield* Stream.empty
      .pipe(
        Stream.concat(startEvent),
        Stream.concat(taskEvents),
        Stream.concat(endEvent),
        Stream.concat(result),
      )
      .pipe(Stream.share({ capacity: "unbounded" }));

    return stream;
  },
  (eff, { bench, harness }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(
          Event.EvalErrorEvent.make({
            id: { harnessID: harness.id, benchID: bench.id },
            error,
          }),
        ),
      ),
    ),
);
