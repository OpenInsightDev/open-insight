import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import {
  Cause,
  Effect,
  FileSystem,
  Match,
  Path,
  Pull,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { SessionResult, TrailResult, type TaskResult } from "./result.ts";

export type TrailEventStream = (trailIdx: number) => Stream.Stream<Event.EvalEvent, EvalError>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;

  trailSem: Semaphore.Semaphore;
  snapSem: Semaphore.Semaphore;
}>;

export const run = Effect.fn(function* ({
  task,
  bench,
  config,
  trailSem,
  snapSem,
}: Options): Effect.fn.Return<
  Stream.Stream<Event.EvalEvent | TaskResult>,
  EvalError,
  Harness.Service | Sandbox.ProviderService | Scope.Scope
> {
  const harness = yield* Harness.Service;

  const taskFields = {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };
  const {
    sandboxConfig,
    grader,
    prompt,
    snapshot: taskTemplate,
    metrics,
    trajMetrics,
    schedMetrics,
  } = task;
  const snapSession = yield* harness
    .runSnapshot(taskTemplate, config)
    .pipe((effect) => snapSem.withPermit(effect))
    .pipe(Effect.mapError(EvalError.harness));

  const runGrader = yield* Grade.createRunner(grader).pipe(Effect.mapError(EvalError.grade));

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }): Effect.fn.Return<
    Stream.Stream<Event.EvalEvent | TrailResult>,
    EvalError,
    Scope.Scope | FileSystem.FileSystem | Path.Path
  > {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const trailFields = { ...taskFields, trailIdx };

    const usageRef = yield* Ref.make<Response.Usage | null>(null);

    const runSession = Effect.fn(function* ({
      session,
      sessionIdx,
      prompt,
    }: Readonly<{
      session: Harness.AgentSession;
      sessionIdx: number;
      prompt: Prompt.Options;
    }>): Effect.fn.Return<Stream.Stream<Event.EvalEvent | SessionResult>, never, Scope.Scope> {
      const sessionFields = { ...trailFields, sessionIdx };

      const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

      const makeRespStream = (prompt: Prompt.Prompt): Stream.Stream<Event.EvalEvent, EvalError> =>
        session
          .prompt(prompt)
          .pipe(Stream.mapError(EvalError.harness))
          .pipe(
            Stream.tap((part) => {
              if (part.type !== "finish") {
                return Effect.void;
              }
              return Effect.all([Ref.set(finishRef, part.reason), Ref.set(usageRef, part.usage)]);
            }),
            Stream.map((part) => Event.SessionStreamEvent.make({ ...sessionFields, part })),
          );

      const promptEvent = Prompt.makeStream(prompt, {
        sandbox: yield* Sandbox.asPromise(sbxSession.sandbox),
        trajectory: session.trajectory,
      }).pipe(Stream.mapError(EvalError.taskExec(task, trailIdx)));

      const trajEvents = promptEvent.pipe(
        Stream.flatMap((prompt) =>
          Stream.succeed(Event.SessionPromptEvent.make({ ...sessionFields, prompt })).pipe(
            Stream.concat(makeRespStream(prompt)),
          ),
        ),
      );

      const startEvent = Stream.succeed(Event.SessionStartEvent.make({ ...sessionFields }));

      const endEvent = Ref.get(finishRef)
        .pipe(Effect.map((reason) => Event.SessionEndEvent.make({ ...sessionFields, reason })))
        .pipe(Stream.fromEffect);

      const result = Effect.all({
        usage: Ref.get(usageRef),
        trajectory: Ref.get(session.trajectory),
      })
        .pipe(Effect.map(({ usage, trajectory }) => SessionResult.make({ usage, trajectory })))
        .pipe(Stream.fromEffect);

      return startEvent
        .pipe(Stream.concat(trajEvents))
        .pipe(Stream.concat(endEvent))
        .pipe(Stream.concat(result))
        .pipe(
          Stream.catch((error) =>
            Stream.succeed(Event.SessionErrorEvent.make({ ...sessionFields, error })),
          ),
        );
    });

    const sessionResultsRef = yield* Ref.make<SessionResult[]>([]);

    const runAttempt = Effect.fn(
      function* (
        session: Harness.AgentSession,
        prompt: Prompt.Options,
        sessionIdx: number,
      ): Effect.fn.Return<
        Stream.Stream<Event.EvalEvent | TrailResult>,
        EvalError,
        FileSystem.FileSystem | Path.Path
      > {
        const sessionStream = runSession({
          session,
          sessionIdx,
          prompt,
        })
          .pipe(Stream.unwrap)
          .pipe(
            Stream.tap(
              Effect.fn(function* (result) {
                if (result._tag !== "SessionResult") {
                  return;
                }
                yield* sessionResultsRef.pipe(Ref.update((results) => [...results, result]));
              }),
            ),
          );

        const trajectory = yield* Ref.get(session.trajectory);
        const usage = yield* Ref.get(usageRef);

        const gradeEvent = runGrader({ sandbox: sbxSession.sandbox, trajectory })
          .pipe(
            Effect.mapError((error) =>
              error instanceof Grade.Retry ? error : EvalError.grade(error),
            ),
          )
          .pipe(Effect.map((grade) => Event.TrailEndEvent.make({ ...trailFields, grade, usage })))
          .pipe(Stream.fromEffect);

        const createRetryStream = Effect.fn(
          function* (retry: Grade.Retry) {
            yield* Effect.logDebug(
              `Grader requested a "${retry.type}" retry for trail ${trailIdx}: ${retry.reason ?? "no reason"}`,
            );

            const nextSession =
              retry.type === "restart"
                ? yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness))
                : session;

            const nextAttempt = yield* runAttempt(nextSession, retry.prompt, sessionIdx + 1);

            const retryEvent = Event.SessionRetryEvent.make({
              ...trailFields,
              sessionIdx,
              reason: retry.reason,
            });

            return Stream.succeed(retryEvent).pipe(Stream.concat(nextAttempt));
          },
          (effect) => effect.pipe(Stream.unwrap),
        );

        const gradeStream = gradeEvent.pipe(Stream.catchTag("Retry", createRetryStream));

        return sessionStream
          .pipe(Stream.concat(gradeStream))
          .pipe(
            Stream.catch((error) =>
              Stream.succeed(Event.TrailErrorEvent.make({ ...trailFields, error })),
            ),
          );
      },
      (effect) =>
        effect.pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
    );

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    return yield* runAttempt(agentSession, prompt, 0);
  });

  return (trailIdx: number) => {
    const trailFields = { ...taskFields, trailIdx };

    const trailStream = Effect.gen(function* () {
      yield* Effect.logDebug(`Trail ${trailIdx} started`);

      const attemptStream = snapSession
        .runSandbox(sandboxConfig)
        .pipe(
          Effect.mapError(EvalError.harness),
          Effect.flatMap((sbxSession) => runTrail({ sbxSession, trailIdx })),
        )
        .pipe(Stream.unwrap);

      return Stream.succeed(Event.TrailStartEvent.make({ ...trailFields })).pipe(
        Stream.concat(attemptStream),
      );
    })
      .pipe(trailSem.withPermit)
      .pipe(Stream.unwrap);

    return trailStream
      .pipe(
        Stream.catch((error) =>
          Stream.succeed(Event.TrailErrorEvent.make({ ...trailFields, error })).pipe(
            Stream.concat(Stream.fail(error)),
          ),
        ),
      )
      .pipe(Stream.onEnd(Effect.logDebug(`Completed trail ${trailIdx}`)))
      .pipe(Stream.scoped);
  };
});
