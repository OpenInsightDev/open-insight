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
  SynchronizedRef,
  Sink,
  Scope,
  Stream,
} from "effect";
import { isFunction } from "effect/Predicate";
import { Prompt, Response } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";
import { Agent, Sandbox } from "@open-insight/core";
import { castDraft, produce } from "immer";
import * as Grade from "#/grade/index.ts";
import type * as TaskMetric from "#/metric/task.ts";
import type * as TrajMetric from "#/metric/traj.ts";
import type { Context as TrajMetricContext } from "#/metric/when.ts";
import * as Task from "../task/index.ts";
import type { Config } from "./config.ts";
import { Error } from "./error.ts";
import {
  type Event,
  TaskMetricEvent,
  TrailStagedEvent,
  TrailStreamEvent,
  TrajMetricEvent,
} from "./event/index.ts";

export type RunTrail = (
  trailIdx: number,
) => Effect.Effect<Grade.Result | undefined, Error, Scope.Scope>;

type StageResults = Readonly<Record<string, Grade.Result>>;
type StageAccuStep = readonly [results: StageResults, grades: ReadonlyArray<Grade.Result>];
type TaskMetricAccu = Readonly<{
  results: ReadonlyArray<TaskMetric.Result>;
  prev: Readonly<Record<string, Schema.JsonObject>>;
}>;
const MetricResult = Schema.Record(Schema.String, Schema.Json);

const advanceStage = (results: StageResults, stage: string, grade: Grade.Result): StageAccuStep => [
  produce(results, (draft) => {
    draft[stage] = grade;
  }),
  [grade],
];

const isVerifGrader = (grader: Grade.Grader): grader is Grade.VerifGrader => !isFunction(grader);

const countToolRounds = (trajectory: Prompt.Prompt): number =>
  trajectory.content.filter(({ role }) => role === "tool").length;

export const createTrail = Effect.fn("exec/createTrail")(
  function* ({
    task,
    bench,
    harness,
    config = {},
    eventQueue,
    onComplete,
  }: {
    task: Task.Task<Grade.Result, Schema.JsonObject>;
    bench: string;
    harness: string;
    config?: Config;
    eventQueue: Queue.Enqueue<Event>;
    onComplete?: (result: TaskMetric.Result) => Effect.Effect<void, Error>;
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

    const taskMetricAccu = yield* SynchronizedRef.make<TaskMetricAccu>({
      results: [],
      prev: {},
    });

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
                  Effect.map((grade) => advanceStage(results, stage.metadata.name, grade)),
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
        const stageResults = yield* Ref.make<StageResults>({});
        const {
          writeFile: _writeFile,
          expose: _expose,
          upload: _upload,
          ...metricSandboxContext
        } = sandboxContext;

        const makeTrajContext = Effect.fn("exec/runTrail/makeTrajContext")(function* () {
          const [results, trajectory] = yield* Effect.all([
            Ref.get(stageResults),
            agent.trajectory(),
          ]);
          return { ...metricSandboxContext, results, trajectory } satisfies TrajMetricContext;
        });

        const runTrajMetric = Effect.fn("exec/runTrail/runTrajMetric")(function* (
          metric: TrajMetric.Metric,
          context: TrajMetricContext,
        ) {
          const result = yield* Effect.tryPromise(() => metric.exec(context)).pipe(
            Effect.flatMap(Schema.decodeEffect(MetricResult)),
          );

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

        const hasExecTrajMetrics = trajMetrics.some(({ when }) => when._tag === "Exec");
        const runExecTrajMetrics = Effect.fn("exec/runTrail/runExecTrajMetrics")(function* () {
          if (!hasExecTrajMetrics) {
            return;
          }

          const context = yield* makeTrajContext();

          for (const metric of trajMetrics) {
            const when = metric.when;
            if (when._tag !== "Exec") {
              continue;
            }

            const check = Effect.tryPromise(() => when.exec(context));
            const shouldRun = yield* when.retry === undefined
              ? check
              : check.pipe(Effect.retry(when.retry));

            if (shouldRun) {
              yield* runTrajMetric(metric, context);
            }
          }
        });

        const scheduledTrajMetrics = trajMetrics.flatMap((metric) => {
          const when = metric.when;
          return when._tag === "Schedule" ? [{ metric, schedule: when }] : [];
        });

        const runTaskMetric = Effect.fn("exec/runTrail/runTaskMetric")(function* (
          metric: TaskMetric.Metric,
          results: ReadonlyArray<TaskMetric.Result>,
          delta: TaskMetric.Result,
          prev: Schema.JsonObject | null,
        ) {
          const result = yield* Effect.tryPromise(() => metric.exec(results, delta, prev)).pipe(
            Effect.flatMap(Schema.decodeEffect(MetricResult)),
          );

          yield* Queue.offer(
            eventQueue,
            TaskMetricEvent.make({
              bench,
              harness,
              task: task.metadata.id,
              id: metric.metadata.id,
              result,
            }),
          );
          return result;
        });

        const runTaskMetrics = Effect.fn("exec/runTrail/runTaskMetrics")(function* (
          delta: TaskMetric.Result,
        ) {
          yield* SynchronizedRef.modifyEffect(
            taskMetricAccu,
            Effect.fn(function* (accu: TaskMetricAccu) {
              const metricResults = yield* Effect.forEach(metrics, (metric) =>
                runTaskMetric(
                  metric,
                  accu.results,
                  delta,
                  accu.prev[metric.metadata.id] ?? null,
                ).pipe(Effect.map((result) => ({ id: metric.metadata.id, result }))),
              );

              return [
                undefined,
                produce(accu, (draft) => {
                  draft.results.push(castDraft(delta));
                  for (const { id, result } of metricResults) {
                    draft.prev[id] = castDraft(result);
                  }
                }),
              ] satisfies readonly [undefined, TaskMetricAccu];
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

          const before = yield* agent.trajectory();
          const finish = yield* agent.prompt({ prompt: [prompt] }).pipe(
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

          const after = yield* agent.trajectory();
          for (let round = countToolRounds(before); round < countToolRounds(after); round += 1) {
            yield* runExecTrajMetrics();
          }
          return usage;
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
                Effect.map((grade) => advanceStage(results, stage.metadata.name, grade)),
                Effect.annotateLogs({ stageIdx }),
              ),
          ),
          Stream.run(Sink.last()),
          Effect.map(Option.getOrUndefined),
          Effect.tap((grade) =>
            grade === undefined || (metrics.length === 0 && onComplete === undefined)
              ? Effect.void
              : agent.trajectory().pipe(
                  Effect.flatMap((trajectory) => {
                    const result = { grade, trajectory } satisfies TaskMetric.Result;
                    const taskMetricEffect =
                      metrics.length === 0 ? Effect.void : runTaskMetrics(result);
                    return onComplete === undefined
                      ? taskMetricEffect
                      : taskMetricEffect.pipe(Effect.andThen(onComplete(result)));
                  }),
                ),
          ),
        );

        if (scheduledTrajMetrics.length === 0) {
          return yield* runStages;
        }

        const runScheduledTrajMetrics = Effect.all(
          scheduledTrajMetrics.map(({ metric, schedule }) =>
            makeTrajContext().pipe(
              Effect.flatMap((context) => runTrajMetric(metric, context)),
              Effect.schedule(schedule),
            ),
          ),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.andThen(Effect.never));

        return yield* Effect.raceFirst(runStages, runScheduledTrajMetrics);
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
