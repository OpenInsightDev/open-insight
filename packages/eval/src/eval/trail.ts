import {
  Effect,
  Equal,
  FileSystem,
  Match,
  Option,
  Path,
  Queue,
  Ref,
  Schema,
  Sink,
  Scope,
  Stream,
} from "effect";
import { isFunction } from "effect/Predicate";
import { Prompt, Response } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import { produce } from "immer";
import * as Grade from "#/grade/index.ts";
import * as Task from "../task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import { type Event, TrailStagedEvent, TrailStreamEvent } from "./event/index.ts";

export type RunTrail = Effect.Effect<Grade.Result | undefined, Error, Scope.Scope>;

type StageResults = Readonly<Record<string, Grade.Result>>;
type StageAccuStep = readonly [results: StageResults, grades: ReadonlyArray<Grade.Result>];

const advance = (results: StageResults, stage: string, grade: Grade.Result): StageAccuStep => [
  produce(results, (draft) => {
    draft[stage] = grade;
  }),
  [grade],
];

const isVerifGrader = (grader: Grade.Grader): grader is Grade.VerifGrader => !isFunction(grader);

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    bench,
    harness,
    config = {},
    eventQueue,
  }: {
    task: Task.Task<Grade.Result, Schema.JsonObject>;
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
    const { snapshot, resources, stages } = task;
    const {
      verifMode = false,
      graderMaxRetries: maxRetries = 3,
      sandbox: { cacheAgentSnapshot: agentCache, cacheTaskSnapshot: taskCache } = {},
    } = config;

    yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name });

    const verifStages = verifMode
      ? yield* Effect.forEach(stages, ({ metadata, grader }, stageIdx) =>
          isVerifGrader(grader)
            ? Effect.succeed({ metadata, grader, stageIdx })
            : Effect.fail(Error.missingVerifier(task, metadata.id)),
        )
      : [];

    yield* Effect.logDebug("Preparing task snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;

    const taskSnapshot = yield* sandboxProvider
      .aquireSnapshot({ snapshot, cache: taskCache })
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
                  cache: agentCache,
                })
                .pipe(Effect.mapError(Error.taskInit(task))),
            onNone: () => Effect.succeed(taskSnapshot),
          }),
        );

    yield* Effect.logDebug("Prepared task snapshot");

    const nextTrailIdx = yield* Ref.make(0);

    const runTrail = Effect.fn(
      function* (trailIdx: number) {
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIdx });
        yield* Effect.logDebug("Starting sandbox for trail");

        const sandbox = yield* sandboxProvider.runSandbox({ handle: trailSnapshot, resources });
        const sandboxContext = yield* Sandbox.asPromise(sandbox);

        const verifyGrader = Effect.fn("exec/runTrail/verifyGrader")(function* (
          grader: Grade.VerifGrader,
          results: StageResults,
        ) {
          const trajectory = yield* Effect.tryPromise(() => grader.verif(sandboxContext))
            .pipe(Effect.mapError(Grade.Error.verify))
            .pipe(Effect.map((traj) => traj ?? Prompt.empty));

          const grade = yield* Grade.run(grader.grade)({
            ...sandboxContext,
            results,
            trajectory,
          });

          if (!Equal.equals(grade, grader.expect)) {
            return yield* Effect.fail(
              Error.taskVerif(
                task,
                grader.expect,
                grade,
              )(new globalThis.Error("Grader result did not match its expected result")),
            );
          }

          return grade;
        });

        if (verifMode) {
          yield* Effect.logDebug("Starting grader verification");
          const runVerifStage = Effect.fn("exec/runTrail/verifyStage")(function* (
            stage: (typeof verifStages)[number],
            results: StageResults,
          ) {
            const { grader, stageIdx } = stage;

            yield* Effect.logDebug(`Verifying grader for stage ${stageIdx}`);
            const grade = yield* verifyGrader(grader, results);
            yield* Effect.logDebug(`Verified grader for stage ${stageIdx}`);
            return grade;
          });

          return yield* Stream.fromIterable(verifStages).pipe(
            Stream.mapAccumEffect(
              (): StageResults => ({}),
              (results, stage) =>
                runVerifStage(stage, results).pipe(
                  Effect.map((grade) => advance(results, stage.metadata.name, grade)),
                  Effect.annotateLogs({ stageIdx: stage.stageIdx }),
                  Effect.mapError(Error.taskVerifExec(task)),
                ),
            ),
            Stream.run(Sink.last()),
            Effect.map(Option.getOrUndefined),
          );
        }

        yield* Effect.logDebug("Starting agent session");
        const agent = yield* agentProvider.runSession({ sandbox });

        // Prompt.Trajectory stores normalized messages and drops response finish parts, so usage
        // is returned from the stream and threaded through the current stage explicitly.
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

          const finish = yield* agent.prompt({ prompt: [prompt] }).pipe(
            Stream.tap((part) =>
              Queue.offer(
                eventQueue,
                TrailStreamEvent.make({
                  bench,
                  harness,
                  task: task.metadata.name,
                  part,
                  trailIdx,
                }),
              ),
            ),
            Stream.filter((part): part is Response.FinishPart => part.type === "finish"),
            Stream.runLast,
          );

          return yield* Option.match(finish, {
            onNone: () =>
              Effect.fail(new globalThis.Error("Agent stream did not produce a finish part")),
            onSome: ({ usage }) => Effect.succeed(usage),
          });
        });

        const runPrompt = Effect.fn("exec/runTrail/runPrompt")(function* (prompt: Task.PromptFn) {
          let first = true;
          let cursor = 0;
          let lastUsage = Option.none<Response.Usage>();

          while (true) {
            const trajectory = yield* agent.trajectory();
            const generated = first ? [] : trajectory.content.slice(cursor);
            cursor = trajectory.content.length;

            const next = yield* prompt({ trajectory, generated });
            if (next === null) {
              return yield* Option.match(lastUsage, {
                onNone: () =>
                  Effect.fail(
                    new globalThis.Error("Stage prompt did not produce an agent response"),
                  ),
                onSome: Effect.succeed,
              });
            }

            const usage = yield* Stream.fromIterable(next.content).pipe(
              Stream.mapEffect(promptAgent),
              Stream.runLast,
            );
            if (Option.isSome(usage)) {
              lastUsage = usage;
            }
            first = false;
          }
        });

        const runGrader: (
          grader: Grade.Grader,
          usage: Response.Usage,
          results: StageResults,
          retries?: number,
        ) => Effect.Effect<
          Readonly<{ grade: Grade.Result; usage: Response.Usage }>,
          Grade.Error | Agent.Error | globalThis.Error
        > = Effect.fn("exec/runTrail/runGrader")(function* (
          grader: Grade.Grader,
          usage: Response.Usage,
          results: StageResults,
          retries = 0,
        ) {
          const trajectory = yield* agent.trajectory();
          const grade = yield* Grade.run(grader)({
            ...sandboxContext,
            results,
            trajectory,
          }).pipe(Effect.result);

          return yield* Match.value(grade).pipe(
            Match.tag("Success", ({ success }) => Effect.succeed({ grade: success, usage })),
            Match.tag("Failure", ({ failure }) =>
              Match.value(failure.reason).pipe(
                Match.tag("Retry", ({ prompt }) =>
                  retries >= maxRetries
                    ? Effect.fail(
                        Grade.Error.exec(
                          new globalThis.Error(
                            `Grader exceeded the maximum of ${maxRetries} retries`,
                            { cause: failure },
                          ),
                        ),
                      )
                    : Effect.logDebug(
                        `Grader requested agent retry ${retries + 1}/${maxRetries}`,
                      ).pipe(
                        Effect.andThen(promptAgent(prompt)),
                        Effect.flatMap((nextUsage) =>
                          runGrader(grader, nextUsage, results, retries + 1),
                        ),
                      ),
                ),
                Match.orElse(() => Effect.fail(failure)),
              ),
            ),
            Match.exhaustive,
          );
        });

        const runStage = Effect.fn("exec/runTrail/runStage")(function* (
          stage: Task.Stage,
          stageIdx: number,
          results: StageResults,
        ) {
          const { metadata, prompt, grader } = stage;
          yield* Effect.logDebug(`Starting stage ${stageIdx}`);
          const promptUsage = yield* runPrompt(prompt);

          const { grade, usage } = yield* runGrader(grader, promptUsage, results);

          yield* Queue.offer(
            eventQueue,
            TrailStagedEvent.make({
              bench,
              harness,
              task: task.metadata.name,
              trailIdx,
              stage: metadata.name,
              grade,
              usage,
            }),
          );
          yield* Effect.logDebug(`Completed stage ${stageIdx}`);
          return grade;
        });

        return yield* Stream.fromIterable(stages).pipe(
          Stream.zipWithIndex,
          Stream.mapAccumEffect(
            (): StageResults => ({}),
            (results, [stage, stageIdx]) =>
              runStage(stage, stageIdx, results).pipe(
                Effect.map((grade) => advance(results, stage.metadata.name, grade)),
                Effect.annotateLogs({ stageIdx }),
              ),
          ),
          Stream.run(Sink.last()),
          Effect.map(Option.getOrUndefined),
        );
      },
      (effect, trailIdx) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: task.metadata.name, trailIdx }),
          Effect.mapError(Error.taskExec(task, trailIdx)),
        ),
    );

    return Ref.getAndUpdate(nextTrailIdx, (idx) => idx + 1).pipe(
      Effect.tap((trailIdx) => Effect.logDebug(`Starting trail ${trailIdx}`)),
      Effect.flatMap((trailIdx) =>
        runTrail(trailIdx).pipe(
          Effect.scoped,
          Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)),
        ),
      ),
    );
  },
  (effect, { task }) => effect.pipe(Effect.annotateLogs({ taskName: task.metadata.name })),
);
