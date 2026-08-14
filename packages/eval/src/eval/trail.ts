import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";
import {
  Effect,
  FileSystem,
  Path,
  Ref,
  Semaphore,
  Stream,
  Array,
  Cause,
  Scope,
  Queue,
  FiberSet,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { SessionResult, TrailResult } from "./result.ts";
import { TaskResult } from "#/event/result.ts";

export type TrailStream = Stream.Stream<Event.EvalEvent, Cause.Done<TrailResult>>;
export type TaskStream = Stream.Stream<Event.EvalEvent, Cause.Done<TaskResult>>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;
  snapSession: Harness.SnapshotSession;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;

  trailCount: number;
}>;

export const makeTaskFields = Effect.fn(function* ({ bench, task }: Options) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };
});

export const make = Effect.fn(
  function* (
    options: Options,
  ): Effect.fn.Return<
    Stream.Stream<Event.EvalEvent, Cause.Done<TaskResult>>,
    EvalError,
    Harness.Service | FileSystem.FileSystem | Path.Path | Sandbox.ProviderService | Scope.Scope
  > {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const harness = yield* Harness.Service;

    const { task, snapSem, trailSem, trailCount } = options;
    const {
      sandboxConfig,
      grader,
      prompt,
      snapshot: taskTemplate,
      metrics,
      trajMetrics,
      schedMetrics,
    } = task;

    const taskFields = yield* makeTaskFields(options);

    const runGrader = yield* Grade.makeRunner(grader).pipe(Effect.mapError(EvalError.grade));
    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const makeTrailStream = Effect.fn(
      function* (trailIdx: number) {
        const trailFields = { ...taskFields, trailIdx };

        const sbxSession = yield* snapSession
          .runSandbox(sandboxConfig)
          .pipe(Effect.mapError(EvalError.harness));

        const usageRef = yield* Ref.make<Response.Usage | null>(null);

        const makeSessionStream = Effect.fn(
          function* ({
            session,
            sessionIdx,
            prompt,
          }: Readonly<{
            session: Harness.AgentSession;
            sessionIdx: number;
            prompt: Prompt.Options;
          }>) {
            const sessionFields = { ...trailFields, sessionIdx };

            const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

            const makeRespStream = (
              prompt: Prompt.Prompt,
            ): Stream.Stream<Event.EvalEvent, EvalError> =>
              session
                .prompt(prompt)
                .pipe(Stream.mapError(EvalError.harness))
                .pipe(
                  Stream.tap((part) => {
                    if (part.type !== "finish") {
                      return Effect.void;
                    }
                    return Effect.all([
                      Ref.set(finishRef, part.reason),
                      Ref.set(usageRef, part.usage),
                    ]);
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
              .pipe(
                Effect.map((reason) => Event.SessionEndEvent.make({ ...sessionFields, reason })),
              )
              .pipe(Stream.fromEffect);

            const result = Effect.all({
              usage: Ref.get(usageRef),
              trajectory: Ref.get(session.trajectory),
            })
              .pipe(
                Effect.map(({ usage, trajectory }) =>
                  Cause.done(SessionResult.make({ usage, trajectory })).pipe(Stream.fromEffect),
                ),
              )
              .pipe(Stream.unwrap);

            return startEvent
              .pipe(Stream.concat(trajEvents))
              .pipe(Stream.concat(endEvent))
              .pipe(Stream.concat(result));
          },
          (effect) => effect.pipe(Stream.unwrap),
        );

        const sessionResultsRef = yield* Ref.make<SessionResult[]>([]);

        const runAttempt = ({
          session,
          prompt,
          sessionIdx,
        }: {
          session: Harness.AgentSession;
          prompt: Prompt.Options;
          sessionIdx: number;
        }): Stream.Stream<
          Event.EvalEvent,
          EvalError | Cause.Done<TrailResult>,
          FileSystem.FileSystem | Path.Path
        > => {
          const sessionStream = makeSessionStream({
            session,
            sessionIdx,
            prompt,
          }).pipe(
            Stream.catchTag("Done", ({ value: result }) =>
              Effect.gen(function* () {
                yield* sessionResultsRef.pipe(Ref.update((results) => [...results, result]));
                return Stream.empty;
              }).pipe(Stream.unwrap),
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
            const result = Cause.done(TrailResult.make({ grade, sessions })).pipe(
              Stream.fromEffect,
            );

            const event = Stream.succeed(
              Event.TrailEndEvent.make({ ...trailFields, grade, usage }),
            );

            return event.pipe(Stream.concat(result));
          }).pipe(Stream.unwrap);

          const makeRetryStream = (retry: Grade.Retry) =>
            Effect.gen(function* () {
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
            }).pipe(Stream.unwrap);

          const gradeStream = gradeResultStream.pipe(Stream.catchTag("Retry", makeRetryStream));

          return sessionStream.pipe(Stream.concat(gradeStream));
        };

        const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));

        return runAttempt({ session: agentSession, prompt, sessionIdx: 0 });
      },
      (effect, trailIdx) =>
        effect
          .pipe(Stream.unwrap)
          .pipe(
            Stream.catchIf(
              (error) => !Cause.isDone(error),
              (error) =>
                Stream.succeed(Event.TrailErrorEvent.make({ ...taskFields, trailIdx, error })),
            ),
          )
          .pipe(
            Stream.provideService(FileSystem.FileSystem, fs),
            Stream.provideService(Path.Path, path),
          ),
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

    const trailQueue = yield* Queue.make<Event.EvalEvent>();
    // join all fibers instead of interrupt when releasing
    const trailFibers = yield* Effect.acquireRelease(FiberSet.make<void, never>(), FiberSet.join);

    for (const trailIdx of Array.range(0, trailCount)) {
      yield* Effect.gen(function* () {
        yield* makeTrailStream(trailIdx)
          // drain stream manually since `Stream.runIntoQueue` hardcoded `Cause.Done`
          .pipe(
            Stream.catchTag("Done", ({ value: result }) =>
              Effect.gen(function* () {
                yield* trailResultsRef.pipe(Ref.update((results) => [...results, result]));
                return Stream.empty;
              }).pipe(Stream.unwrap),
            ),
          )
          .pipe(Stream.runForEach((event) => Queue.offer(trailQueue, event)));
      })
        .pipe(trailSem.withPermit)
        .pipe(FiberSet.run(trailFibers));

      // fair scheduling over trails of all tasks
      yield* Effect.yieldNow;
    }

    const endStream = Effect.gen(function* () {
      const event = Stream.succeed(Event.TaskEndEvent.make({ ...taskFields }));
      const trails = yield* Ref.get(trailResultsRef);
      const result = Cause.done(TaskResult.make({ trails })).pipe(Stream.fromEffect);
      return event.pipe(Stream.concat(result));
    }).pipe(Stream.unwrap);

    const mergedTrailStream = Stream.fromQueue(trailQueue);

    return startEvent
      .pipe(Stream.concat(mergedTrailStream))
      .pipe(Stream.concat(endStream))
      .pipe(
        Stream.provideService(FileSystem.FileSystem, fs),
        Stream.provideService(Path.Path, path),
      );
  },
  (effect, options) =>
    effect.pipe(Stream.unwrap).pipe(
      Stream.catchIf(
        (error) => !Cause.isDone(error),
        (error) =>
          Effect.gen(function* () {
            const taskFields = yield* makeTaskFields(options);
            return Stream.succeed(Event.TaskErrorEvent.make({ ...taskFields, error }));
          }).pipe(Stream.unwrap),
      ),
    ),
);
