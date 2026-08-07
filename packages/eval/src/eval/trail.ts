import { DateTime, Effect, Match, Option, Ref, Schedule, Scope, Schema, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { Agent, Sandbox } from "@open-insight/core";
import { Harness, Prompt } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { TrailResult } from "./result.ts";
import * as Event from "#/event/index.ts";

export type RunTrail = (trailIdx: number) => Effect.Effect<TrailResult, EvalError, Scope.Scope>;

type StageResults = Readonly<Grade.Results>;
type Usage = Response.Usage | null;

const makeVerifAgent = Effect.fn("exec/makeVerifAgent")(function* ({
  verifier,
  sandbox,
}: {
  verifier: Grade.Verif.Exec;
  sandbox: Sandbox.SandboxPromise;
}): Effect.fn.Return<Harness.AgentSession> {
  const trajectory = yield* Effect.tryPromise(() =>
    verifier({ ...sandbox, trajectory: Prompt.empty }),
  ).pipe(
    Effect.mapError((cause) => Harness.HarnessError.agent(Agent.AgentError.trajectory(cause))),
    Effect.map((input) => (input === null ? Prompt.empty : Prompt.make(input))),
    Effect.cached,
  );

  return {
    trajectory,
    prompt: () => Stream.empty,
  } satisfies Harness.AgentSession;
});

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    benchId,
    harnessId,
    task,
    config,
    eventQueue,
    snapshotSession,
  }: {
    benchId: string;
    harnessId: string;
    task: Task.AnyTask;
    config: Config;
    eventQueue: Event.EventEnqueue;
    snapshotSession: Harness.SnapshotSession;
  }): Effect.fn.Return<RunTrail, EvalError, Scope.Scope> {
    const { stages, metrics: taskMetrics, trajMetrics, sandboxConfig } = task;
    const { verifMode, graderMaxRetries: maxRetries } = config;

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

    yield* Effect.logDebug("Prepared task definition");

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
                bench: benchId,
                harness: harnessId,
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
      function* (
        sandboxSession: Harness.SandboxSession,
        idx: number,
      ): Effect.fn.Return<TrailResult, EvalError, Scope.Scope> {
        const startedAt = yield* DateTime.now;
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIdx: idx });
        yield* Effect.logDebug("Starting sandbox for trail");

        const ctx = yield* Sandbox.asPromise(sandboxSession.sandbox);

        yield* Effect.logDebug("Prepared sandbox for trail");

        const stageStream = Stream.fromIterable(stages);

        const agentSessionRef = yield* Ref.make(Option.none<Harness.AgentSession>());
        const getSession = Ref.get(agentSessionRef).pipe(
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

        const getTrajectory = getSession.pipe(
          Effect.flatMap((session) => session.trajectory.pipe(Effect.mapError(EvalError.harness))),
        );

        const promptSession = Effect.fn("exec/runTrail/promptSession")(function* (
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<Usage, EvalError> {
          const session = yield* getSession;
          const prevTrajectory = yield* getTrajectory;
          const usageRef = yield* Ref.make(Option.none<Response.Usage>());

          const responseStream = session.prompt(trajectory).pipe(
            Stream.mapError(EvalError.harness),
            Stream.tap((part) =>
              Event.TrailStreamEvent.makeEffect({
                bench: benchId,
                harness: harnessId,
                task: task.metadata.id,
                part: Schema.decodeUnknownSync(Event.StreamPart)(part),
                trailIdx: idx,
              }).pipe(offer),
            ),
            Stream.tap((part) =>
              part.type === "finish"
                ? Ref.set(
                    usageRef,
                    Option.some(Schema.decodeUnknownSync(Response.Usage)(part.usage)),
                  )
                : Effect.void,
            ),
          );

          yield* responseStream.pipe(
            (stream) => Prompt.fromResponsePartEncodedStream(stream),
            Metric.Traj.run({ metrics: trajMetrics, sandbox: ctx, prevTrajectory }),
            Stream.runForEach(({ id, result, chart }) =>
              Event.TrajMetricEvent.makeEffect({
                bench: benchId,
                harness: harnessId,
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

        const execGrader = Effect.fn("exec/runTrail/executeGrader")(function* <
          G extends Grade.Result,
        >(
          grader: Grade.Grader<G, StageResults>,
          results: StageResults,
          trajectory: Prompt.Trajectory,
        ): Effect.fn.Return<G["Encoded"], EvalError | Grade.Retry, Scope.Scope> {
          return yield* Effect.tryPromise({
            try: () =>
              grader.grade({
                ...ctx,
                prevResults: results,
                trajectory,
              }),
            catch: (cause) =>
              cause instanceof Grade.Retry ? cause : EvalError.grade(Grade.GradeError.exec(cause)),
          });
        });

        const runGrader = Effect.fn("exec/runTrail/runGrader")(function* <G extends Grade.Result>(
          grader: Grade.Grader<G, StageResults>,
          results: StageResults,
        ): Effect.fn.Return<G["Encoded"], EvalError | Grade.Retry, Scope.Scope> {
          const trajectory = yield* getTrajectory;
          return yield* execGrader(grader, results, trajectory);
        });

        const runStage = Effect.fn("exec/runTrail/runStage")(function* (
          { metadata, makePrompt, grader, init, resume }: Task.Stage,
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
            const initialGrade = yield* execGrader(grader, results, Prompt.empty).pipe(
              Effect.map(Option.some),
              Effect.catchTag("Retry", () => Effect.succeed(Option.none())),
            );
            const initialMatches = Option.isSome(initialGrade)
              ? yield* Grade.matches(grader.schema, initialGrade.value, verif.expect).pipe(
                  Effect.mapError(EvalError.grade),
                )
              : false;
            if (initialMatches) {
              return yield* Effect.fail(EvalError.verifInitialMatch(task, verif.expect));
            }

            const agentSession = yield* makeVerifAgent({ verifier: verif.verif, sandbox: ctx });
            yield* Ref.set(agentSessionRef, Option.some(agentSession));
          } else {
            const current = yield* Ref.get(agentSessionRef);
            if (!resume || Option.isNone(current)) {
              yield* Effect.logDebug(`Starting new agent session for stage ${metadata.id}`);
              const agentSession = yield* sandboxSession
                .runAgent()
                .pipe(Effect.mapError(EvalError.harness));
              yield* Ref.set(agentSessionRef, Option.some(agentSession));
            }
          }

          const prompt = makePrompt();
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

          const encodedGrade = yield* runGrader(grader, results).pipe(
            Effect.retry(gradeRetrySchedule),
            Effect.catchTag("Retry", retryLimitExceeded),
          );
          const usage = yield* Ref.get(usageRef);
          if (verif !== undefined) {
            const matches = yield* Grade.matches(grader.schema, encodedGrade, verif.expect).pipe(
              Effect.mapError(EvalError.grade),
            );
            if (!matches) {
              return yield* Effect.fail(EvalError.verifMismatch(task, verif.expect, encodedGrade));
            }
          }

          const grade = yield* Schema.decodeEffect(grader.schema)(encodedGrade).pipe(
            Effect.mapError((error) => EvalError.grade(Grade.GradeError.result(error))),
          );

          yield* Event.TrailStagedEvent.makeEffect({
            bench: benchId,
            harness: harnessId,
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
      (effect, _run, trailIdx) =>
        effect.pipe(
          Effect.annotateLogs({ taskName: task.metadata.name, trailIdx }),
          Effect.mapError(EvalError.taskExec(task, trailIdx)),
        ),
    );

    return (trailIdx) =>
      Effect.logDebug(`Starting trail ${trailIdx}`).pipe(
        Effect.andThen(
          snapshotSession.runSandbox(sandboxConfig).pipe(
            Effect.mapError(EvalError.harness),
            Effect.flatMap((sandboxSession) => runTrail(sandboxSession, trailIdx)),
            Effect.scoped,
          ),
        ),
        Effect.tap((result) => runTaskMetrics(result, trailIdx)),
        Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)),
      );
  },
  (effect, { task }) => effect.pipe(Effect.annotateLogs({ taskName: task.metadata.name })),
);
