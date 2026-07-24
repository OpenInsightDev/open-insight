import * as Metric from "#/metric/index.ts";
import {
  Deferred,
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
import type { Context as TrajMetricContext } from "#/metric/when.ts";
import * as Task from "../task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import { TrailResult } from "./result.ts";
import {
  type Event,
  TaskMetricEvent,
  TrailStagedEvent,
  TrailStreamEvent,
  TrajMetricEvent,
} from "./event/index.ts";

export type RunTrail = (trailIdx: number) => Effect.Effect<TrailResult | null, Error, Scope.Scope>;

type StageResults = Readonly<Record<string, Grade.Result>>;
type PromptState = Readonly<{
  isFirst: boolean;
  cursor: number;
}>;
type PromptPage = readonly [
  usages: ReadonlyArray<Response.Usage>,
  nextState: Option.Option<PromptState>,
];
type VerifStage = Readonly<{
  metadata: Task.Stage["metadata"];
  grader: Grade.VerifGrader;
  stageIdx: number;
}>;
const advanceStage = (results: StageResults, stage: string, grade: Grade.Result): StageResults =>
  produce(results, (draft) => {
    draft[stage] = grade;
  });

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
    const { snapshot, resources, stages, metrics, trajMetrics } = task;
    const {
      verifMode = false,
      graderMaxRetries: maxRetries = 3,
      sandbox: { cacheAgentSnapshot: agentCache, cacheTaskSnapshot: taskCache } = {},
    } = config;

    yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name });

    const verifStages: ReadonlyArray<VerifStage> = verifMode
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

    const runTaskMetrics = yield* Metric.Task.makeAccu(metrics);
    const publishTaskMetrics = Effect.fn("exec/runTrail/publishTaskMetrics")(function* (
      trail: TrailResult,
    ) {
      const outputs = yield* runTaskMetrics(trail);
      yield* Effect.forEach(
        outputs,
        ([metric, result]) =>
          Queue.offer(
            eventQueue,
            TaskMetricEvent.make({
              bench,
              harness,
              task: task.metadata.id,
              id: metric.metadata.id,
              result,
            }),
          ),
        { discard: true },
      );
    });

    const completeTrail = Effect.fn("exec/runTrail/complete")(function* (
      result: TrailResult | null,
    ) {
      if (result === null) {
        return result;
      }

      yield* publishTaskMetrics(result);
      return result;
    });

    const verifyGrader = Effect.fn("exec/runTrail/verifyGrader")(function* (
      sandboxContext: Grade.SandboxContext,
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

      return new TrailResult({ grade, trajectory });
    });

    const runVerifStage = Effect.fn("exec/runTrail/verifyStage")(function* (
      sandboxContext: Grade.SandboxContext,
      stage: VerifStage,
      results: StageResults,
    ) {
      yield* Effect.logDebug(`Verifying grader for stage ${stage.stageIdx}`);
      const result = yield* verifyGrader(sandboxContext, stage.grader, results);
      yield* Effect.logDebug(`Verified grader for stage ${stage.stageIdx}`);
      return result;
    });

    const runTrail = Effect.fn(
      function* (trailIdx: number) {
        yield* Effect.annotateCurrentSpan({ taskName: task.metadata.name, trailIdx });
        yield* Effect.logDebug("Starting sandbox for trail");

        const sandbox = yield* sandboxProvider.runSandbox({ handle: trailSnapshot, resources });
        const sandboxContext = yield* Sandbox.asPromise(sandbox);

        if (verifMode) {
          yield* Effect.logDebug("Starting grader verification");
          const result = yield* Stream.fromIterable(verifStages).pipe(
            Stream.mapAccumEffect(
              (): StageResults => ({}),
              (results, stage) =>
                runVerifStage(sandboxContext, stage, results).pipe(
                  Effect.map(
                    (result) =>
                      [
                        advanceStage(results, stage.metadata.name, result.grade),
                        [result],
                      ] satisfies readonly [StageResults, ReadonlyArray<TrailResult>],
                  ),
                  Effect.annotateLogs({ stageIdx: stage.stageIdx }),
                  Effect.mapError(Error.taskVerifExec(task)),
                ),
            ),
            Stream.run(Sink.last()),
            Effect.map(Option.getOrNull),
          );
          return yield* completeTrail(result);
        }

        yield* Effect.logDebug("Starting agent session");
        const agentRef = yield* Ref.make(yield* agentProvider.runSession({ sandbox }));
        const stageResults = yield* Ref.make<StageResults>({});
        const {
          writeFile: _writeFile,
          expose: _expose,
          upload: _upload,
          ...metricSandboxContext
        } = sandboxContext;

        const makeTrajContext = Effect.fn("exec/runTrail/makeTrajContext")(function* () {
          const currentAgent = yield* Ref.get(agentRef);
          const [results, trajectory] = yield* Effect.all([
            Ref.get(stageResults),
            currentAgent.trajectory(),
          ]);
          return { ...metricSandboxContext, results, trajectory } satisfies TrajMetricContext;
        });
        const trajMetricOptions = {
          metrics: trajMetrics,
          context: makeTrajContext(),
        };
        const publishTrajMetric = Effect.fn("exec/runTrail/publishTrajMetric")(function* ([
          metric,
          result,
        ]: Metric.Traj.RunResult) {
          yield* Queue.offer(
            eventQueue,
            TrajMetricEvent.make({
              bench,
              harness,
              task: task.metadata.id,
              trailIdx,
              id: metric.metadata.id,
              result,
            }),
          );
        });

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

          const currentAgent = yield* Ref.get(agentRef);
          const before = yield* currentAgent.trajectory();
          const finish = yield* currentAgent.prompt({ prompt: [prompt] }).pipe(
            Stream.tap((part) =>
              Queue.offer(
                eventQueue,
                TrailStreamEvent.make({
                  bench,
                  harness,
                  task: task.metadata.id,
                  part,
                  trailIdx,
                }),
              ),
            ),
            Stream.filter((part): part is Response.FinishPart => part.type === "finish"),
            Stream.runLast,
          );

          const usage = yield* Option.match(finish, {
            onNone: () =>
              Effect.fail(new globalThis.Error("Agent stream did not produce a finish part")),
            onSome: ({ usage }) => Effect.succeed(usage),
          });

          // FIXME: Evaluate trajectory metrics after each newly appended message. Agent.prompt
          // currently commits its trajectory only when the stream ends, so this post-turn replay
          // evaluates every `Traj` condition against the same final trajectory.
          const metricOutputs = yield* Metric.Traj.run(trajMetricOptions, before);
          yield* Effect.forEach(metricOutputs, publishTrajMetric, { discard: true });
          return usage;
        });

        const runPrompt = Effect.fn("exec/runTrail/runPrompt")(function* (
          options: Task.PromptOptions,
        ) {
          const prompt = Task.makePrompt(options);
          const initialState: PromptState = { isFirst: true, cursor: 0 };
          const usages = Stream.paginate(
            initialState,
            Effect.fn(function* ({ isFirst, cursor }) {
              const currentAgent = yield* Ref.get(agentRef);
              const trajectory = yield* currentAgent.trajectory();
              const generated = isFirst ? [] : trajectory.content.slice(cursor);

              const next = yield* prompt({ trajectory, generated });
              if (next === null) {
                return [[], Option.none<PromptState>()] satisfies PromptPage;
              }

              const usage = yield* Stream.fromIterable(next.content).pipe(
                Stream.mapEffect(promptAgent),
                Stream.runLast,
              );

              return [
                Option.toArray(usage),
                Option.some({ isFirst: false, cursor: trajectory.content.length }),
              ] satisfies PromptPage;
            }),
          );

          return yield* usages.pipe(
            Stream.runLast,
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new globalThis.Error("Stage prompt did not produce an agent response"),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
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
          const currentAgent = yield* Ref.get(agentRef);
          const trajectory = yield* currentAgent.trajectory();
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
          const { metadata, prompt, grader, continue: shouldContinue = true } = stage;
          if (stageIdx > 0 && !shouldContinue) {
            yield* Ref.set(agentRef, yield* agentProvider.runSession({ sandbox }));
          }
          yield* Ref.set(stageResults, results);
          yield* Effect.logDebug(`Starting stage ${stageIdx}`);
          const promptUsage = yield* runPrompt(prompt);

          const { grade, usage } = yield* runGrader(grader, promptUsage, results);

          yield* Queue.offer(
            eventQueue,
            TrailStagedEvent.make({
              bench,
              harness,
              task: task.metadata.id,
              trailIdx,
              stage: metadata.id,
              grade,
              usage,
            }),
          );
          yield* Effect.logDebug(`Completed stage ${stageIdx}`);
          return grade;
        });

        const runStages = Stream.fromIterable(stages).pipe(
          Stream.zipWithIndex,
          Stream.mapAccumEffect(
            (): StageResults => ({}),
            (results, [stage, stageIdx]) =>
              runStage(stage, stageIdx, results).pipe(
                Effect.map(
                  (grade) =>
                    [
                      advanceStage(results, stage.metadata.name, grade),
                      [grade],
                    ] satisfies readonly [StageResults, ReadonlyArray<Grade.Result>],
                ),
                Effect.annotateLogs({ stageIdx }),
              ),
          ),
          Stream.run(Sink.last()),
          Effect.map(Option.getOrNull),
          Effect.flatMap((grade) =>
            grade === null
              ? Effect.succeed(null)
              : Ref.get(agentRef).pipe(
                  Effect.flatMap((agent) => agent.trajectory()),
                  Effect.map((trajectory) => new TrailResult({ grade, trajectory })),
                ),
          ),
        );

        const haltMetrics = yield* Deferred.make<void>();
        const { result } = yield* Effect.all(
          {
            result: runStages.pipe(Effect.tap(() => Deferred.succeed(haltMetrics, undefined))),
            metrics: Metric.Traj.schedule(trajMetricOptions, Deferred.await(haltMetrics)).pipe(
              Stream.runForEach(publishTrajMetric),
            ),
          },
          { concurrency: "unbounded" },
        );
        return yield* completeTrail(result);
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
        Effect.tap(() => Effect.logDebug(`Completed trail ${trailIdx}`)),
      );
  },
  (effect, { task }) => effect.pipe(Effect.annotateLogs({ taskName: task.metadata.name })),
);
