import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import { Effect, FileSystem, Path, Ref, Scope, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

export type TrailEventStream = (
  trailIdx: number,
) => Stream.Stream<Event.EvalEvent, EvalError, FileSystem.FileSystem | Path.Path>;

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
  const { sandboxConfig, grader, prompt, snapshot: taskTemplate } = task;
  const snapSession = yield* harness
    .runSnapshot(taskTemplate, config)
    .pipe((effect) => snapSem.withPermit(effect));

  const runGrader = yield* Grade.createRunner(grader).pipe(Effect.mapError(EvalError.grade));

  const runTrail = Effect.fn(function* ({
    sbxSession,
    trailIdx,
  }: {
    sbxSession: Harness.SandboxSession;
    trailIdx: number;
  }): Effect.fn.Return<
    Stream.Stream<Event.EvalEvent, EvalError, FileSystem.FileSystem | Path.Path>,
    EvalError,
    Scope.Scope
  > {
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
    }>): Effect.fn.Return<Stream.Stream<Event.EvalEvent, EvalError>, EvalError, Scope.Scope> {
      const sessionFields = { ...trailFields, sessionIdx };

      const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

      const promptStream = Prompt.makeStream(prompt, {
        sandbox: yield* Sandbox.asPromise(sbxSession.sandbox),
        trajectory: session.trajectory,
      }).pipe(Stream.mapError(EvalError.taskExec(task, trailIdx)));

      const makeRespStream = (prompt: Prompt.Prompt): Stream.Stream<Event.EvalEvent, EvalError> =>
        session.prompt(prompt).pipe(
          Stream.mapError(EvalError.harness),
          Stream.tap((part) => {
            if (part.type !== "finish") {
              return Effect.void;
            }
            return Effect.all([Ref.set(finishRef, part.reason), Ref.set(usageRef, part.usage)]);
          }),
          Stream.map((part) => Event.SessionStreamEvent.make({ ...sessionFields, part })),
        );

      const promptEventStream = promptStream.pipe(
        Stream.flatMap((prompt) =>
          Stream.succeed(Event.SessionPromptEvent.make({ ...sessionFields, prompt })).pipe(
            Stream.concat(makeRespStream(prompt)),
          ),
        ),
      );

      const endStream = Ref.get(finishRef)
        .pipe(Effect.map((reason) => Event.SessionEndEvent.make({ ...sessionFields, reason })))
        .pipe(Stream.fromEffect);

      return Stream.succeed(Event.SessionStartEvent.make({ ...sessionFields }))
        .pipe(Stream.concat(promptEventStream))
        .pipe(Stream.concat(endStream))
        .pipe(
          Stream.catch((error) =>
            Stream.succeed(Event.SessionErrorEvent.make({ ...sessionFields, error })).pipe(
              Stream.concat(Stream.fail(error)),
            ),
          ),
        );
    });

    const runAttempt = (
      session: Harness.AgentSession,
      prompt: Prompt.Options,
      sessionIdx: number,
    ): Stream.Stream<Event.EvalEvent, EvalError, FileSystem.FileSystem | Path.Path> => {
      const sessionStream = runSession({
        session,
        sessionIdx,
        prompt,
      }).pipe(Stream.unwrap);

      const gradeEvent = Effect.gen(function* () {
        const trajectory = yield* Ref.get(session.trajectory);
        const grade = yield* runGrader({ sandbox: sbxSession.sandbox, trajectory });
        const usage = yield* Ref.get(usageRef);
        return Event.TrailEndEvent.make({ ...trailFields, grade, usage });
      }).pipe(
        Effect.mapError((error) => (error instanceof Grade.Retry ? error : EvalError.grade(error))),
      );

      const gradeStream = gradeEvent
        .pipe(Effect.map(Stream.succeed))
        .pipe(
          Effect.catchTag(
            "Retry",
            Effect.fn(function* (retry) {
              yield* Effect.logDebug(
                `Grader requested a "${retry.type}" retry for trail ${trailIdx}: ${retry.reason ?? "no reason"}`,
              );

              const nextSession =
                retry.type === "restart"
                  ? yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness))
                  : session;

              return Stream.succeed(
                Event.SessionRetryEvent.make({
                  ...trailFields,
                  sessionIdx,
                  reason: retry.reason,
                }),
              ).pipe(Stream.concat(runAttempt(nextSession, retry.prompt, sessionIdx + 1)));
            }),
          ),
        )
        .pipe(Stream.unwrap);

      return sessionStream.pipe(Stream.concat(gradeStream));
    };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    return runAttempt(agentSession, prompt, 0);
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
