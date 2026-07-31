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
import { Prompt } from "@open-insight/core/internal";
import { produce } from "immer";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import { TrailResult } from "./result.ts";
import * as Event from "#/event/index.ts";

export type RunTrail = (trailIdx: number) => Effect.Effect<TrailResult, Error, Scope.Scope>;

type StageResults = Readonly<Record<string, Grade.Result>>;
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
    ).pipe(Effect.mapError(Agent.Error.trajectory));
    return input === null ? Prompt.empty : Prompt.make(input);
  }),
  prompt: () => Stream.empty,
});

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    bench,
    harness,
    config,
    eventQueue,
  }: {
    task: Task.AnyTask;
    bench: string;
    harness: string;
    config: Config;
    eventQueue: Event.EventEnqueue;
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
        return yield* Effect.fail(Error.missingVerifier(task, missingStageIds));
      }
    }

    yield* Effect.logDebug("Preparing task snapshot");

    const sandboxProvider = yield* Sandbox.ProviderService;
    const agentProvider = yield* Agent.ProviderService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const taskSnapshot = yield* sandboxProvider
      .aquireSnapshot({ snapshot, cache: taskCache })
      .pipe(Effect.mapError(Error.taskInit(task)));

    const trailSnapshot = !verifMode
      ? yield* agentProvider.snapshotExtension.pipe(
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
        )
      : taskSnapshot;

    yield* Effect.logDebug("Prepared task snapshot");

    const taskMetricRunners = yield* Effect.forEach(taskMetrics, Metric.Task.run);
    const runTaskMetrics = Effect.fn("exec/runTaskMetrics")(function* (
      trailResult: TrailResult,
      trailIdx: number,
    ): Effect.fn.Return<void, Error> {
      yield* Effect.forEach(
        taskMetricRunners,
        (runTaskMetric) =>
          runTaskMetric(trailResult).pipe(
            Effect.flatMap(({ id, result, chart }) =>
              Event.TaskMetricEvent.makeEffect({
                bench,
                harness,
                task: task.metadata.id,
                id,
                result,
                chart,
              }).pipe(offer),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.mapError(Error.taskExec(task, trailIdx)));
    });

    const runTrail = Effect.fn(
      function* (idx: number): Effect.fn.Return<TrailResult, Error, Scope.Scope> {
        const startedAt = yield* DateTime.now;
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIdx: idx });
        yield* Effect.logDebug("Starting sandbox for trail");

        const sandbox = yield* sandboxProvider
          .runSandbox({ handle: trailSnapshot, resources })
          .pipe(Effect.mapError(Error.taskExec(task, idx)));
        const ctx = yield* Sandbox.asPromise(sandbox);
        const promptSandbox = {
          $: ctx.$,
          cmd: ctx.cmd,
          readFile: ctx.readFile,
          download: ctx.download,
        } satisfies Task.SandboxContext;

        const stageStream = Stream.fromIterable(stages);

        const sessionRef = yield* Ref.make(Option.none<Agent.Agent>());
        const getSession = Ref.get(sessionRef).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  Error.taskExec(
                    task,
                    idx,
                  )(new globalThis.Error("Agent session has not been started")),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
        const getTrajectory = getSession.pipe(
          Effect.flatMap((session) => session.trajectory().pipe(Effect.mapError(Error.agent))),
        );

        const promptSession = Effect.fn("exec/runTrail/promptSession")(function* (
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<Usage, Error> {
          const session = yield* getSession;
          const prevTrajectory = yield* getTrajectory;
          const usageRef = yield* Ref.make(Option.none<Response.Usage>());

          const responseStream = session.prompt(trajectory).pipe(
            Stream.mapError(Error.agent),
            Stream.tap((part) =>
              Event.TrailStreamEvent.makeEffect({
                bench,
                harness,
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
                bench,
                harness,
                task: task.metadata.id,
                trailIdx: idx,
                id,
                result,
                chart,
              }).pipe(offer),
            ),
            Effect.mapError(Error.taskExec(task, idx)),
          );

          const usage = yield* Ref.get(usageRef);

          return Option.getOrNull(usage);
        });

        const runPromptFn = Effect.fn("exec/runTrail/runPromptFn")(function* (
          fn: Task.PromptFn,
        ): Effect.fn.Return<Usage, Error> {
          const usages = Stream.unfold(
            undefined,
            Effect.fn(function* (): Effect.fn.Return<
              readonly [Usage, undefined] | undefined,
              Error
            > {
              const trajectory = yield* getTrajectory;
              const prompt = yield* fn({ ...promptSandbox, trajectory }).pipe(
                Effect.mapError(Error.taskExec(task, idx)),
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
                    Error.taskExec(
                      task,
                      idx,
                    )(new globalThis.Error("Stage prompt did not produce an agent response")),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
        });

        const executeGrader = Effect.fn("exec/runTrail/executeGrader")(function* <
          G extends Grade.Result,
        >(
          grader: Grade.Grader<G, StageResults>,
          results: StageResults,
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<G, Error | Grade.Retry, Scope.Scope> {
          return yield* Grade.run(grader)({
            ...ctx,
            prevResults: results,
            trajectory,
          }).pipe(
            Effect.provideService(Sandbox.ProviderService, sandboxProvider),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.catchTag("GradeError", (error) => Effect.fail(Error.grade(error))),
          );
        });

        const runGrader = Effect.fn("exec/runTrail/runGrader")(function* <G extends Grade.Result>(
          grader: Grade.Grader<G, StageResults>,
          results: StageResults,
        ): Effect.fn.Return<G, Error | Grade.Retry, Scope.Scope> {
          const trajectory = yield* getTrajectory;
          return yield* executeGrader(grader, results, trajectory);
        });

        const runStage = Effect.fn("exec/runTrail/runStage")(function* (
          { metadata, prompt: promptOptions, grader, init, resume }: Task.Stage,
          results: StageResults,
        ): Effect.fn.Return<Readonly<{ grade: Grade.Result; usage: Usage }>, Error, Scope.Scope> {
          yield* Effect.logDebug(`Starting stage ${metadata.id}`);
          const verif = verifMode && Grade.isVerifiable(grader) ? grader.verif : undefined;

          if (init !== null) {
            yield* Effect.tryPromise({
              try: () => init(ctx),
              catch: Error.taskExec(task, idx),
            });
          }

          if (verif !== undefined) {
            const expectedGrade = yield* Schema.decodeUnknownEffect(grader.schema)(
              verif.expect,
            ).pipe(Effect.mapError((error) => Error.grade(Grade.Error.result(error))));

            const initialGrade = yield* executeGrader(grader, results, Prompt.empty).pipe(
              Effect.map(Option.some),
              Effect.catchTag("Retry", () => Effect.succeed(Option.none())),
            );
            if (Option.isSome(initialGrade) && Equal.equals(initialGrade.value, expectedGrade)) {
              return yield* Effect.fail(Error.verifInitialMatch(task, verif.expect));
            }

            const session = makeVerifAgent({ verifier: verif.run, sandbox: ctx });
            yield* Ref.set(sessionRef, Option.some(session));
          } else {
            const currentSession = yield* Ref.get(sessionRef);
            if (!resume || Option.isNone(currentSession)) {
              yield* Effect.logDebug(`Starting new agent session for stage ${metadata.id}`);
              const session = yield* agentProvider
                .runSession(sandbox)
                .pipe(Effect.mapError(Error.agent));
              yield* Ref.set(sessionRef, Option.some(session));
            }
          }

          const initialUsage = yield* runPromptFn(Task.makePromptFn(promptOptions));
          const usageRef = yield* Ref.make(initialUsage);

          const promptRetry = Effect.fn("exec/runTrail/runStage/promptRetry")(function* (
            { prompt: input }: Grade.Retry,
            attempt: number,
          ): Effect.fn.Return<Usage, Error> {
            const prompt = Prompt.make(input);

            if (verif !== undefined) {
              return yield* Effect.fail(Error.verifMismatch(task, verif.expect, prompt));
            }

            yield* Effect.logDebug(`Grader requested agent retry ${attempt}/${maxRetries}`);
            return yield* promptSession(prompt);
          });

          const shouldRetryGrade = Match.type<Error | Grade.Retry>().pipe(
            Match.tag("Retry", () => true),
            Match.orElse(() => false),
          );

          const gradeRetrySchedule = Schedule.recurs(maxRetries).pipe(
            Schedule.while(({ input }: Schedule.Metadata<number, Error | Grade.Retry>) =>
              shouldRetryGrade(input),
            ),
            Schedule.tap(({ attempt, input }: Schedule.Metadata<number, Error | Grade.Retry>) =>
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
            function* ({ prompt }: Grade.Retry): Effect.fn.Return<never, Error> {
              return yield* Effect.fail(
                Error.grade(
                  Grade.Error.exec(
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
            ).pipe(Effect.mapError((error) => Error.grade(Grade.Error.result(error))));
            if (!Equal.equals(grade, expectedGrade)) {
              return yield* Effect.fail(Error.verifMismatch(task, verif.expect, grade));
            }
          }

          const encodedGrade = yield* Schema.encodeUnknownEffect(grader.schema)(grade).pipe(
            Effect.mapError((error) => Error.grade(Grade.Error.result(error))),
          );

          yield* Event.TrailStagedEvent.makeEffect({
            bench,
            harness,
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
          grade: Option.Option<Grade.Result>;
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
                  results: produce(state.results, (draft) => {
                    draft[stage.metadata.name] = grade;
                  }),
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
                Error.taskExec(task, idx)(new globalThis.Error("Task does not define any stages")),
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
          Effect.mapError(Error.taskExec(task, trailIdx)),
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
