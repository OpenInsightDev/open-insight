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
  Queue,
  FiberSet,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { SessionResult, TaskResult, TrailResult } from "./result.ts";

export type TrailStream = Stream.Stream<Event.EvalEvent, Cause.Done<TrailResult>>;
export type TaskStream = Stream.Stream<Event.EvalEvent, Cause.Done<TaskResult>>;

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;

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

export const makeStream = Effect.fn(
  function* (options: Options) {
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
        const sandbox = sbxSession.sandbox;
        const sbxPromise = yield* Sandbox.asPromise(sbxSession.sandbox);

        const schedMetricStreams = schedMetrics
          .map(Metric.Sched.makeStream({ sandbox }))
          .map(Stream.mapError(EvalError.metric));

        const usageRef = yield* Ref.make<Response.Usage | null>(null);

        const makeSessionStream = Effect.fn(function* ({
          session,
          sessionIdx,
          prompt,
        }: Readonly<{
          session: Harness.AgentSession;
          sessionIdx: number;
          prompt: Prompt.Options;
        }>) {
          const sessionFields = { ...trailFields, sessionIdx };

          const trajectory = yield* Ref.get(session.trajectory);

          const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

          const makeRespStream = (
            prompt: Prompt.Prompt,
          ): Stream.Stream<Prompt.AnyStreamPart, EvalError> =>
            session
              .prompt(prompt)
              .pipe(Stream.mapError(EvalError.harness))
              .pipe(
                Stream.tap(
                  Effect.fn(function* (part) {
                    if (part.type !== "finish") {
                      return;
                    }
                    yield* Effect.all([
                      Ref.set(finishRef, part.reason),
                      Ref.set(usageRef, part.usage),
                    ]);
                  }),
                ),
              );

          const prompts = Prompt.makeStream(prompt, {
            trajectory: session.trajectory,
            sandbox: sbxPromise,
          }).pipe(Stream.mapError(EvalError.taskExec(task, trailIdx)));

          const makeTrajStream = (prompt: Prompt.Prompt) =>
            Effect.gen(function* () {
              const [respStreamForEvent, respStreamForMetric] = yield* makeRespStream(prompt).pipe(
                Stream.broadcastN({ n: 2, capacity: "unbounded" }),
              );

              const promptPartStream = yield* Prompt.fromStreamPartStream(respStreamForMetric).pipe(
                // shared by each traj metric
                Stream.share({ capacity: "unbounded" }),
              );
              const metricStreams = trajMetrics
                .map(Metric.Traj.makeStream({ prompt, trajectory, stream: promptPartStream }))
                .map(
                  Stream.mapError((error) =>
                    error instanceof Metric.MetricError ? EvalError.metric(error) : error,
                  ),
                );
              const metricEventStreams = metricStreams.map(
                Stream.map((result) =>
                  Event.TrailMetricEvent.make({
                    ...trailFields,
                    id: result.id,
                    value: result.value,
                    chart: result.chart,
                  }),
                ),
              );

              const promptEvent = Stream.succeed(
                Event.SessionPromptEvent.make({ ...sessionFields, prompt }),
              );
              const streamEvents = respStreamForEvent.pipe(
                Stream.map((part) => Event.SessionStreamEvent.make({ ...sessionFields, part })),
              );
              const metricEvents = Stream.mergeAll(metricEventStreams, {
                concurrency: "unbounded",
              });

              return Stream.empty.pipe(
                Stream.concat(promptEvent),
                Stream.concat(streamEvents),
                Stream.merge(metricEvents),
              );
            }).pipe(Stream.unwrap);

          const trajEvents = prompts
            .pipe(Stream.flatMap(makeTrajStream))
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
              Effect.flatMap(({ usage, trajectory }) =>
                Cause.done(SessionResult.make({ usage, trajectory })),
              ),
            )
            .pipe(Stream.fromEffect);

          return Stream.empty.pipe(
            Stream.concat(startEvent),
            Stream.concat(trajEvents),
            Stream.concat(endEvent),
            Stream.concat(result),
          );
        }, Stream.unwrap);

        const sessionResultsRef = yield* Ref.make<SessionResult[]>([]);

        const makeAttemptStream = ({
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
              sessionResultsRef
                .pipe(Ref.update((results) => [...results, result]))
                .pipe(() => Stream.empty),
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

              const nextAttempt = makeAttemptStream({
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

          return Stream.empty.pipe(Stream.concat(sessionStream)).pipe(Stream.concat(gradeStream));
        };

        const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
        const trailStream = makeAttemptStream({ session: agentSession, prompt, sessionIdx: 0 });

        const mergedSchedMetricStreams = Stream.mergeAll(schedMetricStreams, {
          concurrency: "unbounded",
        });
        const schedMetricEvents = mergedSchedMetricStreams.pipe(
          Stream.map((result) => Event.TrailMetricEvent.make({ ...trailFields, ...result })),
        );

        return Stream.empty.pipe(Stream.concat(trailStream), Stream.merge(schedMetricEvents));
      },
      (effect, trailIdx) =>
        effect.pipe(Stream.unwrap).pipe(
          Stream.catchIf(
            (error) => !Cause.isDone(error),
            (error) =>
              Stream.succeed(Event.TrailErrorEvent.make({ ...taskFields, trailIdx, error })),
          ),
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

    const trailQueue = yield* Queue.make<Event.EvalEvent, Cause.Done>();
    // join all fibers instead of interrupt when releasing
    const trailFibers = yield* Effect.acquireRelease(
      FiberSet.make<void, never>(),
      FiberSet.awaitEmpty,
    );

    for (const trailIdx of Array.range(0, trailCount - 1)) {
      yield* makeTrailStream(trailIdx)
        .pipe(
          Stream.catchTag("Done", ({ value: result }) =>
            trailResultsRef
              .pipe(Ref.update((results) => [...results, result]))
              .pipe(() => Stream.empty),
          ),
        )
        .pipe(Stream.runIntoQueue(trailQueue))
        .pipe(trailSem.withPermit)
        .pipe(FiberSet.run(trailFibers));

      // ensure fair scheduling over trails of all tasks
      yield* Effect.yieldNow;
    }

    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ ...taskFields }));

    const result = Ref.get(trailResultsRef)
      .pipe(Effect.flatMap((trails) => Cause.done(TaskResult.make({ trails }))))
      .pipe(Stream.fromEffect);

    const mergedTrailStream = Stream.fromQueue(trailQueue);

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(mergedTrailStream),
      Stream.concat(endEvent),
      Stream.concat(result),
    );
  },
  (effect, options) =>
    effect.pipe(Stream.unwrap).pipe(
      Stream.catchIf(
        (error) => !Cause.isDone(error),
        (error) =>
          makeTaskFields(options)
            .pipe(Effect.map((taskFields) => Event.TaskErrorEvent.make({ ...taskFields, error })))
            .pipe(Stream.fromEffect),
      ),
    ) satisfies Stream.Stream<
      Event.EvalEvent,
      Cause.Done<TaskResult>,
      FileSystem.FileSystem | Path.Path | Harness.Service | Sandbox.ProviderService
    >,
);
