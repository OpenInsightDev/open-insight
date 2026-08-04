import {
  DateTime,
  Effect,
  Equal,
  FileSystem,
  Match,
  Option,
  Path,
  Ref,
  Schedule,
  Scope,
  Schema,
  Stream,
} from "effect";
import { Response } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import { Harness, Prompt } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { TrailResult } from "./result.ts";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";

export type RunTrail = (trailIdx: number) => Effect.Effect<TrailResult, EvalError, Scope.Scope>;

type StageResults = Readonly<Grade.Results>;
type Usage = Response.Usage | null;

const makeVerifAgent = ({
  verifier,
  sandbox,
}: {
  verifier: Grade.VerifExec;
  sandbox: Sandbox.SandboxPromise;
}): Agent.Agent => ({
  trajectory: Effect.fn(function* () {
    const input = yield* Effect.tryPromise(() =>
      verifier({ ...sandbox, trajectory: Prompt.empty }),
    ).pipe(Effect.mapError(Agent.AgentError.trajectory));
    return input === null ? Prompt.empty : Prompt.make(input);
  }),
  prompt: () => Stream.empty,
});

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    bench,
    task,
    config,
    eventQueue,
  }: {
    bench: Bench.Bench;
    task: Task.AnyTask;
    config: Config;
    eventQueue: Event.EventEnqueue;
  }): Effect.fn.Return<
    RunTrail,
    EvalError,
    | Harness.Service
    | FileSystem.FileSystem
    | ChildProcessSpawner.ChildProcessSpawner
    | Path.Path
    | Scope.Scope
  > {
    const { snapshot, resources, stages, metrics: taskMetrics, trajMetrics } = task;
    const {
      verifMode,
      graderMaxRetries: maxRetries,
      cacheAgentSnapshot: agentCache,
      cacheTaskSnapshot: taskCache,
    } = config;

    const offer = Event.offerTo(eventQueue);

    yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name });

    // Verif mode requires every grader is verifiable
    if (verifMode) {
      const missingStageIds = stages
        .filter(({ grader }) => !Grade.isVerifiable(grader))
        .map(({ metadata }) => metadata.id);
      if (missingStageIds.length > 0) {
        return yield* Effect.fail(EvalError.missingVerifier(task, missingStageIds));
      }
    }

    yield* Effect.logDebug("Preparing task snapshot");

    const harness = yield* Harness.Service;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const harnessRun = yield* harness
      .run(snapshot, { resources })
      .pipe(Effect.mapError(EvalError.harness));
    const sandboxPromise = Sandbox.asPromise(harnessRun.sandbox);

    yield* Effect.logDebug("Prepared task snapshot");

    const taskMetricRunners = yield* Effect.forEach(taskMetrics, Metric.Task.run);
    const runTaskMetrics = Effect.fn("exec/runTaskMetrics")(function* (
      trailResult: TrailResult,
      trailIdx: number,
    ): Effect.fn.Return<void, EvalError> {
      yield* Effect.forEach(
        taskMetricRunners,
        (run) =>
          run(trailResult).pipe(
            Effect.flatMap(({ id, result, chart }) =>
              Event.TaskMetricEvent.makeEffect({
                bench: bench.metadata.id,
                harness: harness.metadata.id,
                task: task.metadata.id,
                id,
                result,
                chart,
              }).pipe(offer),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.mapError(EvalError.taskExec(task, trailIdx)));
    });

    const runTrail = Effect.fn(
      function* (idx: number): Effect.fn.Return<TrailResult, EvalError, Scope.Scope> {
        const startedAt = yield* DateTime.now;
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIdx: idx });
        yield* Effect.logDebug("Starting sandbox for trail");

        const stageStream = Stream.fromIterable(stages);

        const sessionRef = yield* Ref.make(Option.none<Harness.Session>());
        const getSession = Ref.get(sessionRef).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  EvalError.taskExec(
                    task,
                    idx,
                  )(new globalThis.Error("Agent session has not been started")),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );

        const promptSession = Effect.fn("exec/runTrail/promptSession")(function* (
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<Usage, EvalError> {
          const session = yield* getSession;
          const prevTrajectory = yield* getTrajectory;
          const usageRef = yield* Ref.make(Option.none<Response.Usage>());

          const responseStream = session.prompt(trajectory).pipe(
            Stream.mapError(EvalError.agent),
            Stream.tap((part) =>
              Event.TrailStreamEvent.makeEffect({
                bench: bench.metadata.id,
                harness: harness.metadata.id,
                task: task.metadata.id,
                part,
                trailIdx: idx,
              }).pipe(offer),
            ),
            Stream.tap((part) =>
              part.type === "finish" ? Ref.set(usageRef, Option.some(part.usage)) : Effect.void,
            ),
          );

          yield* responseStream.pipe(
            (stream) => Prompt.fromResponsePartStream(stream),
            Metric.Traj.run({ metrics: trajMetrics, sandbox: ctx, prevTrajectory }),
            Stream.runForEach(({ id, result, chart }) =>
              Event.TrajMetricEvent.makeEffect({
                bench: bench.metadata.id,
                harness: harness.metadata.id,
                task: task.metadata.id,
                trailIdx: idx,
                id,
                result,
                chart,
              }).pipe(offer),
            ),
            Effect.mapError(EvalError.taskExec(task, idx)),
          );

          const usage = yield* Ref.get(usageRef);

          return Option.getOrNull(usage);
        });

        const runPromptFn = Effect.fn("exec/runTrail/runPromptFn")(function* (
          fn: Task.PromptFn,
        ): Effect.fn.Return<Usage, EvalError> {
          const usages = Stream.unfold(
            undefined,
            Effect.fn(function* (): Effect.fn.Return<
              readonly [Usage, undefined] | undefined,
              EvalError
            > {
              const trajectory = yield* getTrajectory;
              const prompt = yield* fn({ ...ctx, trajectory }).pipe(
                Effect.mapError(EvalError.taskExec(task, idx)),
              );

              if (prompt === null) {
                return undefined;
              }

              const usage = yield* promptSession(prompt);
              return [usage, undefined] satisfies readonly [Usage, undefined];
            }),
          );

          return yield* usages.pipe(
            Stream.runLast,
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    EvalError.taskExec(
                      task,
                      idx,
                    )(new globalThis.Error("Stage prompt did not produce an agent response")),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
        });

        const execGrader = Effect.fn("exec/runTrail/executeGrader")(function* (
          grader: Grade.Grader,
          results: StageResults,
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<unknown, EvalError | Grade.Retry, Scope.Scope> {
          return yield* Grade.run(grader)({
            ...ctx,
            prevResults: results,
            trajectory,
          }).pipe(
            Effect.provideService(Sandbox.ProviderService, sandboxProvider),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
          );
        });

        const runGrader = Effect.fn("exec/runTrail/runGrader")(function* <G extends Grade.Result>(
          grader: Grade.Grader<G, StageResults>,
          results: StageResults,
        ): Effect.fn.Return<G["Type"], EvalError | Grade.Retry, Scope.Scope> {
          const trajectory = yield* getTrajectory;
          return yield* execGrader(grader, results, trajectory);
        });

        const runStage = Effect.fn("exec/runTrail/runStage")(function* (
          { metadata, prompt, grader, init, resume }: Task.Stage,
          results: StageResults,
        ): Effect.fn.Return<
          Readonly<{ grade: Grade.Result["Type"]; usage: Usage }>,
          EvalError,
          Scope.Scope
        > {
          yield* Effect.logDebug(`Starting stage ${metadata.id}`);
          const verif = verifMode && Grade.isVerifiable(grader) ? grader.verif : undefined;

          if (init !== null) {
            yield* Effect.tryPromise({
              try: () => init(ctx),
              catch: EvalError.taskExec(task, idx),
            });
          }

          if (verif !== undefined) {
            const expectedGrade = yield* Schema.decodeUnknownEffect(grader.schema)(
              verif.expect,
            ).pipe(Effect.mapError((error) => EvalError.grade(Grade.GradeError.result(error))));

            const initialGrade = yield* execGrader(grader, results, Prompt.empty).pipe(
              Effect.map(Option.some),
              Effect.catchTag("Retry", () => Effect.succeed(Option.none())),
            );
            if (Option.isSome(initialGrade) && Equal.equals(initialGrade.value, expectedGrade)) {
              return yield* Effect.fail(EvalError.verifInitialMatch(task, verif.expect));
            }

            const session = makeVerifAgent({ verifier: verif.verif, sandbox: ctx });
            yield* Ref.set(sessionRef, Option.some(session));
          } else {
            const currentSession = yield* Ref.get(sessionRef);
            if (!resume || Option.isNone(currentSession)) {
              yield* Effect.logDebug(`Starting new agent session for stage ${metadata.id}`);
              const session = yield* agentProvider
                .runSession(sandbox)
                .pipe(Effect.mapError(EvalError.agent));
              yield* Ref.set(sessionRef, Option.some(session));
            }
          }

          const initialUsage = yield* runPromptFn(prompt);
          const usageRef = yield* Ref.make(initialUsage);

          const promptRetry = Effect.fn("exec/runTrail/runStage/promptRetry")(function* (
            { prompt: input }: Grade.Retry,
            attempt: number,
          ): Effect.fn.Return<Usage, EvalError> {
            const prompt = Prompt.make(input);

            if (verif !== undefined) {
              return yield* Effect.fail(EvalError.verifMismatch(task, verif.expect, prompt));
            }

            yield* Effect.logDebug(`Grader requested agent retry ${attempt}/${maxRetries}`);
            return yield* promptSession(prompt);
          });

          const shouldRetryGrade = Match.type<EvalError | Grade.Retry>().pipe(
            Match.tag("Retry", () => true),
            Match.orElse(() => false),
          );

          const gradeRetrySchedule = Schedule.recurs(maxRetries).pipe(
            Schedule.while(({ input }: Schedule.Metadata<number, EvalError | Grade.Retry>) =>
              shouldRetryGrade(input),
            ),
            Schedule.tap(({ attempt, input }: Schedule.Metadata<number, EvalError | Grade.Retry>) =>
              Match.value(input).pipe(
                Match.tag("Retry", (retry) =>
                  promptRetry(retry, attempt).pipe(
                    Effect.flatMap((usage) => Ref.set(usageRef, usage)),
                  ),
                ),
                Match.orElse(() => Effect.void),
              ),
            ),
          );

          const retryLimitExceeded = Effect.fn("exec/runTrail/runStage/retryLimitExceeded")(
            function* ({ prompt }: Grade.Retry): Effect.fn.Return<never, EvalError> {
              return yield* Effect.fail(
                EvalError.grade(
                  Grade.GradeError.exec(
                    new globalThis.Error(`Grader exceeded the maximum of ${maxRetries} retries`, {
                      cause: prompt,
                    }),
                  ),
                ),
              );
            },
          );

          const grade = yield* runGrader(grader, results).pipe(
            Effect.retry(gradeRetrySchedule),
            Effect.catchTag("Retry", retryLimitExceeded),
          );
          const usage = yield* Ref.get(usageRef);
          if (verif !== undefined) {
            const expectedGrade = yield* Schema.decodeUnknownEffect(grader.schema)(
              verif.expect,
            ).pipe(Effect.mapError((error) => EvalError.grade(Grade.GradeError.result(error))));
            if (!Equal.equals(grade, expectedGrade)) {
              return yield* Effect.fail(EvalError.verifMismatch(task, verif.expect, grade));
            }
          }

          const encodedGrade = yield* Schema.encodeUnknownEffect(grader.schema)(grade).pipe(
            Effect.mapError((error) => EvalError.grade(Grade.GradeError.result(error))),
          );

          yield* Event.TrailStagedEvent.makeEffect({
            bench: bench.metadata.id,
            harness: harness.metadata.id,
            task: task.metadata.id,
            trailIdx: idx,
            stage: metadata.id,
            grade: encodedGrade,
            usage,
          }).pipe(offer);

          yield* Effect.logDebug(`Completed stage ${metadata.id}`);
          return { grade, usage };
        });

        type StagesState = Readonly<{
          results: StageResults;
          grade: Option.Option<Grade.Result["Type"]>;
          usage: Usage;
        }>;

        const state = yield* stageStream.pipe(
          Stream.runFoldEffect(
            (): StagesState => ({
              results: {},
              grade: Option.none(),
              usage: null,
            }),
            (state, stage) =>
              runStage(stage, state.results).pipe(
                Effect.map(({ grade, usage }) => ({
                  results: { ...state.results, [stage.metadata.name]: grade },
                  grade: Option.some(grade),
                  usage,
                })),
              ),
          ),
        );

        const grade = yield* state.grade.pipe(
          Option.match({
            onNone: () =>
              Effect.fail(
                EvalError.taskExec(
                  task,
                  idx,
                )(new globalThis.Error("Task does not define any stages")),
              ),
            onSome: Effect.succeed,
          }),
        );

        const trajectory = yield* getTrajectory;
        const finishedAt = yield* DateTime.now;
        return {
          startedAt,
          finishedAt,
          grade,
          trajectory,
          usage: state.usage,
        } satisfies TrailResult;
      },
      (effect, trailIdx) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: task.metadata.name, trailIdx }),
          Effect.mapError(EvalError.taskExec(task, trailIdx)),
        ),
    );

    return (trailIdx) =>
      Effect.logDebug(`Starting trail ${trailIdx}`).pipe(
        Effect.andThen(runTrail(trailIdx).pipe(Effect.scoped)),
        Effect.tap((result) => runTaskMetrics(result, trailIdx)),
        Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)),
      );
  },
  (effect, { task }) => effect.pipe(Effect.annotateLogs({ taskName: task.metadata.name })),
);
