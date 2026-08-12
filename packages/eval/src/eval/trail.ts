import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import { Effect, FileSystem, Option, Path, Ref, Scope, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

export type TrailEventStream = (trailIdx: number) => Stream.Stream<Event.EvalEvent>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;
  eventQueue: Event.EventEnqueue;

  trailSem: Semaphore.Semaphore;
  snapSem: Semaphore.Semaphore;
}>;

export const createTrail = Effect.fn(function* ({
  task,
  bench,
  eventQueue,
  config,
  trailSem,
  snapSem,
}: Options) {
  const harness = yield* Harness.Service;

  const taskFields = {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };

  const { metrics: taskMetrics, trajMetrics, sandboxConfig, grader, snapshot: taskTemplate } = task;
  const { verifMode } = config;

  const snapSession = yield* harness.runSnapshot(taskTemplate).pipe(snapSem.withPermit);
  const runGrader = yield* Grade.createRunner(grader).pipe(Effect.mapError(EvalError.grade));

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }): Effect.fn.Return<
    Stream.Stream<Event.EvalEvent, EvalError, FileSystem.FileSystem | Path.Path | Scope.Scope>,
    EvalError,
    FileSystem.FileSystem | Path.Path | Scope.Scope
  > {
    const trailFields = { ...taskFields, trailIdx };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const agentSessionRef = yield* Ref.make(agentSession);

    const promptRef = yield* Ref.make<Prompt.Options>(task.prompt);

    const restartSession = Effect.fn(function* (): Effect.fn.Return<void, EvalError, Scope.Scope> {
      yield* Effect.logDebug(`Restarting agent session for trail ${trailIdx}`);
      const session = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
      yield* Ref.set(agentSessionRef, session);
    });

    type TrailState = Readonly<
      | { phase: "run"; sessionIdx: number }
      | { phase: "grade"; session: Harness.AgentSession; sessionIdx: number }
    >;

    // Each pull either starts an attempt (running the session's event stream) or
    // grades the just-completed attempt, appending the retry event when needed.
    const trailStream = Stream.flatten(
      Stream.unfold(
        { phase: "run", sessionIdx: 0 } satisfies TrailState,
        Effect.fn(function* (
          state: TrailState,
        ): Effect.fn.Return<
          readonly [Stream.Stream<Event.EvalEvent, EvalError>, TrailState] | undefined,
          EvalError,
          FileSystem.FileSystem | Path.Path | Scope.Scope
        > {
          switch (state.phase) {
            case "run": {
              const session = yield* Ref.get(agentSessionRef);
              const prompt = yield* Ref.get(promptRef);
              const sessionStream = yield* runSession({
                sandbox: sbxSession.sandbox,
                session,
                trailIdx,
                sessionIdx: state.sessionIdx,
                prompt,
              });
              return [
                sessionStream,
                { phase: "grade", session, sessionIdx: state.sessionIdx },
              ] as const;
            }
            case "grade": {
              const trajectory = yield* Ref.get(state.session.trajectory);
              const retry = yield* runGrader({ sandbox: sbxSession.sandbox, trajectory }).pipe(
                Effect.mapError((error) =>
                  error instanceof Grade.Retry ? error : EvalError.grade(error),
                ),
                Effect.matchEffect({
                  onSuccess: () => Effect.succeed(Option.none<Grade.Retry>()),
                  onFailure: (error) =>
                    error instanceof Grade.Retry
                      ? Effect.succeed(Option.some(error))
                      : Effect.fail(error),
                }),
              );
              if (Option.isSome(retry)) {
                const retryEvent = Event.SessionRetryEvent.make({
                  ...trailFields,
                  sessionIdx: state.sessionIdx,
                  reason: retry.value.reason,
                });
                yield* Effect.logDebug(
                  `Grader requested a "${retry.value.type}" retry for trail ${trailIdx}: ${retry.value.reason ?? "no reason"}`,
                );
                if (retry.value.type === "restart") {
                  yield* restartSession();
                }
                yield* Ref.set(promptRef, retry.value.prompt);
                return [
                  Stream.succeed(retryEvent),
                  { phase: "run", sessionIdx: state.sessionIdx + 1 },
                ] as const;
              }
              return undefined;
            }
          }
        }),
      ),
    );

    return trailStream;
  });

  const runSession = Effect.fn(function* ({
    sandbox,
    session,
    trailIdx,
    sessionIdx,
    prompt = task.prompt,
  }: Readonly<{
    sandbox: Sandbox.Sandbox;
    session: Harness.AgentSession;
    trailIdx: number;
    sessionIdx: number;
    prompt?: Prompt.Options;
  }>): Effect.fn.Return<Stream.Stream<Event.EvalEvent, EvalError>, EvalError, Scope.Scope> {
    const sessionFields = { ...taskFields, trailIdx, sessionIdx };

    const startEvent = Event.SessionStartEvent.make({ ...sessionFields });
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const promptStream = Prompt.makeStream(prompt, {
      sandbox: yield* Sandbox.asPromise(sandbox),
      trajectory: session.trajectory,
    }).pipe(Stream.mapError(EvalError.taskExec(task, trailIdx)));

    const responseEvents = (prompt: Prompt.Prompt): Stream.Stream<Event.EvalEvent, EvalError> =>
      session.prompt(prompt).pipe(
        Stream.mapError(EvalError.harness),
        Stream.tap((part) =>
          part.type === "finish" ? Ref.set(finishRef, part.reason) : Effect.void,
        ),
        Stream.map((part) => Event.SessionStreamEvent.make({ ...sessionFields, part })),
      );

    const sessionEvents = Stream.concat(
      Stream.succeed(startEvent),
      Stream.concat(
        promptStream.pipe(
          Stream.flatMap((prompt) =>
            Stream.concat(
              Stream.succeed(Event.SessionPromptEvent.make({ ...sessionFields, prompt })),
              responseEvents(prompt),
            ),
          ),
        ),
        Stream.fromEffect(
          Ref.get(finishRef).pipe(
            Effect.map((reason) => Event.SessionEndEvent.make({ ...sessionFields, reason })),
          ),
        ),
      ),
    );

    return sessionEvents.pipe(
      Stream.catchIf(
        () => true,
        (error) =>
          Stream.concat(
            Stream.succeed(Event.SessionErrorEvent.make({ ...sessionFields, error })),
            Stream.fail(error),
          ),
      ),
    );
  });

  return (trailIdx: number) =>
    Effect.logDebug(`Trail ${trailIdx} started`)
      .pipe(() =>
        snapSession.runSandbox(sandboxConfig).pipe(
          Effect.mapError(EvalError.harness),
          Effect.flatMap((sbxSession) => runTrail({ sbxSession, trailIdx })),
          Effect.scoped,
        ),
      )
      .pipe(Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)))
      .pipe(trailSem.withPermit);
});
