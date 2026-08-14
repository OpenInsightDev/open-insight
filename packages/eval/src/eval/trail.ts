import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import { Effect, FileSystem, Path, Ref, Scope, Semaphore, Stream, Array } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { SessionResult, TrailResult } from "./result.ts";
import { TaskResult } from "../event/result.ts";

export type TrailStream = Stream.Stream<Event.EvalEvent, TrailResult>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;
  snapSession: Harness.SnapshotSession;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;

  trailCount: number;
}>;

export const run = Effect.fn(function* ({
  task,
  bench,
  config,
  snapSession,
  snapSem,
  trailSem,
  trailCount,
}: Options): Effect.fn.Return<
  Stream.Stream<Event.EvalEvent, TaskResult>,
  EvalError,
  FileSystem.FileSystem | Path.Path | Harness.Service | Sandbox.ProviderService | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const harness = yield* Harness.Service;

  const {
    sandboxConfig,
    grader,
    prompt,
    snapshot: taskTemplate,
    metrics,
    trajMetrics,
    schedMetrics,
  } = task;

  const { trailConcurrency } = config;

  const taskFields = {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };

  const runGrader = yield* Grade.createRunner(grader).pipe(Effect.mapError(EvalError.grade));

  const createTrailStream = Effect.fn(
    function* (trailIdx: number) {
      const trailFields = { ...taskFields, trailIdx };

      const sbxSession = yield* snapSession
        .runSandbox(sandboxConfig)
        .pipe(Effect.mapError(EvalError.harness));

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const usageRef = yield* Ref.make<Response.Usage | null>(null);

      const runSession = Effect.fn(function* ({
        session,
        sessionIdx,
        prompt,
      }: Readonly<{
        session: Harness.AgentSession;
        sessionIdx: number;
        prompt: Prompt.Options;
      }>): Effect.fn.Return<Stream.Stream<Event.EvalEvent, SessionResult>> {
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

        const trajEvents = promptEvent
          .pipe(
            Stream.flatMap((prompt) =>
              Stream.succeed(Event.SessionPromptEvent.make({ ...sessionFields, prompt })).pipe(
                Stream.concat(makeRespStream(prompt)),
              ),
            ),
          )
          .pipe(
            Stream.catch((error) =>
              Stream.succeed(Event.SessionErrorEvent.make({ ...sessionFields, error })),
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
          .pipe(
            Effect.map(({ usage, trajectory }) =>
              Stream.fail(SessionResult.make({ usage, trajectory })),
            ),
          )
          .pipe(Stream.unwrap);

        return startEvent
          .pipe(Stream.concat(trajEvents))
          .pipe(Stream.concat(endEvent))
          .pipe(Stream.concat(result)) satisfies Stream.Stream<Event.EvalEvent, SessionResult>;
      });

      const sessionResultsRef = yield* Ref.make<SessionResult[]>([]);

      const runAttempt = ({
        session,
        prompt,
        sessionIdx,
      }: {
        session: Harness.AgentSession;
        prompt: Prompt.Options;
        sessionIdx: number;
      }): Stream.Stream<Event.EvalEvent, EvalError | TrailResult> => {
        const sessionStream = runSession({
          session,
          sessionIdx,
          prompt,
        })
          .pipe(Stream.unwrap)
          .pipe(
            Stream.catchTag(
              "SessionResult",
              Effect.fn(
                function* (result) {
                  yield* sessionResultsRef.pipe(Ref.update((results) => [...results, result]));
                  return Stream.empty;
                },
                (effect) => effect.pipe(Stream.unwrap),
              ),
            ),
          );

        const gradeResultStream = Effect.gen(function* () {
          const trajectory = yield* Ref.get(session.trajectory);
          const usage = yield* Ref.get(usageRef);
          const grade = yield* runGrader({ sandbox: sbxSession.sandbox, trajectory }).pipe(
            Effect.mapError((error) =>
              error instanceof Grade.Retry ? error : EvalError.grade(error),
            ),
          );

          const sessions = yield* Ref.get(sessionResultsRef);
          const result = Stream.fail(TrailResult.make({ grade, sessions }));

          const event = Stream.succeed(Event.TrailEndEvent.make({ ...trailFields, grade, usage }));

          return event.pipe(Stream.concat(result));
        }).pipe(Stream.unwrap);

        const createRetryStream = Effect.fn(
          function* (retry: Grade.Retry) {
            yield* Effect.logDebug(
              `Grader requested a "${retry.type}" retry for trail ${trailIdx}: ${retry.reason ?? "no reason"}`,
            );

            const nextSession =
              retry.type === "restart"
                ? yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness))
                : session;

            const nextAttempt = runAttempt({
              session: nextSession,
              prompt: retry.prompt ?? prompt,
              sessionIdx: sessionIdx + 1,
            });

            const retryEvent = Stream.succeed(
              Event.SessionRetryEvent.make({
                ...trailFields,
                sessionIdx,
                reason: retry.reason,
              }),
            );

            return retryEvent.pipe(Stream.concat(nextAttempt));
          },
          (effect) => effect.pipe(Stream.unwrap),
        );

        const gradeStream = gradeResultStream
          .pipe(Stream.catchTag("Retry", createRetryStream))
          .pipe(
            Stream.provideService(FileSystem.FileSystem, fs),
            Stream.provideService(Path.Path, path),
          );

        return sessionStream.pipe(Stream.concat(gradeStream));
      };

      const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));

      return runAttempt({ session: agentSession, prompt, sessionIdx: 0 })
        .pipe(
          Stream.provideService(FileSystem.FileSystem, fs),
          Stream.provideService(Path.Path, path),
        )
        .pipe(
          Stream.catch((error) =>
            Stream.succeed(Event.TrailErrorEvent.make({ ...taskFields, trailIdx, error })),
          ),
        );
    },
    (effect) => effect.pipe(Stream.unwrap),
  );

  const trailResultsRef = yield* Ref.make<Array<TrailResult>>([]);

  const startEvent = Stream.succeed(
    Event.TaskStartEvent.make({
      ...taskFields,
      metrics: metrics.map((metric) => metric.metadata),
      trajMetrics: trajMetrics.map((metric) => metric.metadata),
      schedMetrics: schedMetrics.map((metric) => metric.metadata),
      task: task.metadata,
    }),
  );

  // TODO 公平调度策略，trailSem
  const trailStreams = Array.range(0, trailCount).map(
    Effect.fn(
      function* (trailIdx) {
        const stream = createTrailStream(trailIdx).pipe(
          Stream.catchTag(
            "TrailResult",
            Effect.fn(
              function* (result) {
                yield* trailResultsRef.pipe(Ref.update((results) => [...results, result]));
                return Stream.empty;
              },
              (effect) => effect.pipe(Stream.unwrap),
            ),
          ),
        );
        return stream;
      },
      (effect) => effect.pipe(Stream.unwrap),
    ),
  );
  const mergedTrailStream = Stream.mergeAll(trailStreams, { concurrency: trailConcurrency });

  const endStream = Effect.gen(function* () {
    const event = Stream.succeed(Event.TaskEndEvent.make({ ...taskFields }));
    const trails = yield* Ref.get(trailResultsRef);
    const result = Stream.fail(TaskResult.make({ trails }));
    return event.pipe(Stream.concat(result));
  }).pipe(Stream.unwrap);

  return startEvent
    .pipe(Stream.concat(mergedTrailStream))
    .pipe(Stream.concat(endStream))
    .pipe(Stream.provideService(FileSystem.FileSystem, fs), Stream.provideService(Path.Path, path))
    .pipe(
      Stream.catch((error) => Stream.succeed(Event.TaskErrorEvent.make({ ...taskFields, error }))),
    );
});
