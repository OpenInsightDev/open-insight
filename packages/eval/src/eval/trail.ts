import { Effect, Equal, FileSystem, Match, Option, Path, Queue, Ref, Scope, Stream } from "effect";
import { isFunction } from "effect/Predicate";
import { Prompt } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import * as Grade from "#/grade/index.ts";
import * as Task from "../task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import { type Event, TaskStreamPartEvent } from "./event/index.ts";

export type RunTrail = Effect.Effect<Grade.Result | undefined, Error, Scope.Scope>;

const isVerifGrader = (grader: Grade.Grader): grader is Grade.VerifGrader => !isFunction(grader);

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    bench,
    harness,
    config = {},
    eventQueue,
  }: {
    task: Task.Task;
    bench: string;
    harness: string;
    config?: Config;
    eventQueue: Queue.Enqueue<Event>;
  }): Effect.fn.Return<
    RunTrail,
    Error,
    | Sandbox.ProviderService
    | Agent.ProviderService
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshot, resources, stages, metrics } = task;
    const {
      verifMode = false,
      graderMaxRetries = 3,
      sandbox: { cacheAgentSnapshot, cacheTaskSnapshot } = {},
    } = config;

    yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name });

    if (verifMode && !stages.some(({ grader }) => isVerifGrader(grader))) {
      yield* Effect.logDebug("Skipping task without verifiable graders");
      return Effect.succeed(undefined);
    }

    yield* Effect.logDebug("Preparing task snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;

    const taskSnapshot = yield* sandboxProvider
      .aquireSnapshot({ snapshot, cache: cacheTaskSnapshot })
      .pipe(Effect.mapError(Error.taskInit(task)));

    const trailSnapshot = verifMode
      ? taskSnapshot
      : yield* agentProvider.snapshotExtension.pipe(
          Option.match({
            onSome: ({ instructions, context }) =>
              sandboxProvider
                .deriveSnapshot({
                  handle: taskSnapshot,
                  instructions,
                  context: context ?? snapshot.context,
                  cache: cacheAgentSnapshot,
                })
                .pipe(Effect.mapError(Error.taskInit(task))),
            onNone: () => Effect.succeed(taskSnapshot),
          }),
        );

    yield* Effect.logDebug("Prepared task snapshot");

    const nextTrailIndex = yield* Ref.make(0);

    const runTrail = Effect.fn(
      function* (trailIndex: number) {
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIndex });
        yield* Effect.logDebug("Starting sandbox for trail");

        const sandbox = yield* sandboxProvider.runSandbox({ handle: trailSnapshot, resources });
        const sandboxContext = yield* Sandbox.asPromise(sandbox);

        const verifyGrader = Effect.fn("exec/runTrail/verifyGrader")(function* (
          grader: Grade.VerifGrader,
        ) {
          const trajectory = yield* Effect.tryPromise(() => grader.verif(sandboxContext)).pipe(
            Effect.mapError(Grade.Error.verify),
          );
          const grade = yield* Grade.run(grader.grade)({
            ...sandboxContext,
            trajectory: trajectory ?? Prompt.empty,
          });

          if (!Equal.equals(grade, grader.expect)) {
            return yield* Effect.fail(
              Error.taskVerif(
                task.metadata,
                grader.expect,
                grade,
              )(new globalThis.Error("Grader result did not match its expected result")),
            );
          }

          return grade;
        });

        if (verifMode) {
          yield* Effect.logDebug("Starting grader verification");
          let finalGrade: Grade.Result | undefined;

          for (const [stageIndex, { grader }] of stages.entries()) {
            if (!isVerifGrader(grader)) {
              continue;
            }

            finalGrade = yield* Effect.gen(function* () {
              yield* Effect.logDebug(`Verifying grader for stage ${stageIndex}`);
              const grade = yield* verifyGrader(grader);
              yield* Effect.logDebug(`Verified grader for stage ${stageIndex}`);
              return grade;
            }).pipe(
              Effect.annotateLogs({ stageIndex }),
              Effect.mapError(Error.taskVerifExec(task)),
            );
          }

          return finalGrade;
        }

        yield* Effect.logDebug("Starting agent session");
        const agent = yield* agentProvider.runSession({ sandbox });

        const promptAgent = Effect.fn("exec/runTrail/promptAgent")(function* (
          prompt: Prompt.Message,
        ) {
          if (prompt.role !== "user") {
            return yield* Effect.fail(
              new globalThis.Error(
                `Task prompt stream must contain user messages, got ${prompt.role}`,
              ),
            );
          }

          yield* agent.prompt({ prompt: [prompt] }).pipe(
            Stream.runForEach((part) =>
              Queue.offer(
                eventQueue,
                TaskStreamPartEvent.make({
                  bench,
                  harness,
                  task: task.metadata.name,
                  parts: [part],
                  trailIndex,
                }),
              ),
            ),
          );
        });

        const runGrader: (
          grader: Grade.Grader,
          retryCount?: number,
        ) => Effect.Effect<Grade.Result, Grade.Error | Agent.Error | globalThis.Error> = Effect.fn(
          "exec/runTrail/runGrader",
        )(function* (grader: Grade.Grader, retryCount = 0) {
          const trajectory = yield* agent.trajectory();
          const grade = yield* Grade.run(grader)({ ...sandboxContext, trajectory }).pipe(
            Effect.result,
          );

          return yield* Match.value(grade).pipe(
            Match.tag("Success", ({ success }) => Effect.succeed(success)),
            Match.tag("Failure", ({ failure }) =>
              Match.value(failure.reason).pipe(
                Match.tag("Retry", ({ prompt }) =>
                  Effect.gen(function* () {
                    if (retryCount >= graderMaxRetries) {
                      return yield* Effect.fail(
                        Grade.Error.exec(
                          new globalThis.Error(
                            `Grader exceeded the maximum of ${graderMaxRetries} retries`,
                            { cause: failure },
                          ),
                        ),
                      );
                    }

                    const nextRetryCount = retryCount + 1;
                    yield* Effect.logDebug(
                      `Grader requested agent retry ${nextRetryCount}/${graderMaxRetries}`,
                    );
                    yield* promptAgent(prompt);
                    return yield* runGrader(grader, nextRetryCount);
                  }),
                ),
                Match.orElse(() => Effect.fail(failure)),
              ),
            ),
            Match.exhaustive,
          );
        });

        let finalGrade: Grade.Result | undefined;

        for (const [stageIndex, { prompt, grader }] of stages.entries()) {
          finalGrade = yield* Effect.gen(function* () {
            yield* Effect.logDebug(`Starting stage ${stageIndex}`);
            yield* prompt.pipe(Stream.runForEach(promptAgent));

            const grade = yield* runGrader(grader);
            yield* Effect.logDebug(`Completed stage ${stageIndex}`);
            return grade;
          }).pipe(Effect.annotateLogs({ stageIndex }));
        }

        return finalGrade;
      },
      (effect, trailIndex) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: task.metadata.name, trailIndex }),
          Effect.mapError(Error.taskExec(task, trailIndex)),
        ),
    );

    return Effect.gen(function* () {
      const trailIndex = yield* Ref.getAndUpdate(nextTrailIndex, (index) => index + 1);
      yield* Effect.logDebug(`Starting trail ${trailIndex}`);

      const result = yield* runTrail(trailIndex).pipe(Effect.scoped);

      yield* Effect.logDebug(`Completed trail ${trailIndex}`);
      return result;
    });
  },
  (effect, { task }) => effect.pipe(Effect.annotateLogs({ taskName: task.metadata.name })),
);
