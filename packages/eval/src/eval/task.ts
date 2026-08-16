import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Response } from "@open-insight/core/internal";
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
  PubSub,
  Fiber,
  Match,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

export type Options = Readonly<{
  task: Task.AnyTask;
  bench: Bench.Bench;
  config: Config;

  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;

  trailCount: number;
}>;

const makeTaskFields = Effect.fn(function* ({ bench, task }: Options) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
    taskId: task.metadata.id,
  };
});

export const make = Effect.fn(
  function* (options: Options) {
    const harness = yield* Harness.Service;

    const { task, snapSem, trailSem, trailCount } = options;
    const {
      sandboxConfig,
      grader,
      prompt,
      snapshot: taskTemplate,
      metrics: taskMetrics,
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
          ): Stream.Stream<Response.AnyStreamPart, EvalError> =>
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
                Cause.done(Event.SessionResult.make({ usage, trajectory })),
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

        const sessionResultsQueue = yield* Queue.make<Event.SessionResult, Cause.Done>();

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
          EvalError | Cause.Done<Event.TrailResult>,
          FileSystem.FileSystem | Path.Path
        > => {
          const sessionStream = makeSessionStream({
            session,
            sessionIdx,
            prompt,
          }).pipe(
            Stream.catchTag("Done", ({ value: result }) =>
              Queue.offer(sessionResultsQueue, result).pipe(() => Stream.empty),
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

            yield* Queue.end(sessionResultsQueue);

            const result = Queue.collect(sessionResultsQueue)
              .pipe(Effect.flatMap((sessions) => Cause.done(TrailResult.make({ grade, sessions }))))
              .pipe(Stream.fromEffect);

            const endEvent = Stream.succeed(
              Event.TrailEndEvent.make({ ...trailFields, grade, usage }),
            );

            return Stream.empty.pipe(Stream.concat(endEvent), Stream.concat(result));
          }).pipe(Stream.unwrap);

          const makeRetryStream = (retry: Grade.Retry) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `Grader requested a "${retry.type}" retry for trail ${trailIdx}: ${retry.reason ?? "unknown reason"}`,
              );

              const nextSession = yield* Match.value(retry.type).pipe(
                Match.when("restart", () =>
                  sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness)),
                ),
                Match.when("continue", () => Effect.succeed(session)),
                Match.exhaustive,
              );
              const nextAttempt = makeAttemptStream({
                session: nextSession,
                prompt: retry.prompt,
                sessionIdx: sessionIdx + 1,
              });

              const retryEvent = Stream.succeed(
                Event.SessionRetryEvent.make({
                  ...trailFields,
                  sessionIdx,
                  reason: retry.reason,
                }),
              );

              return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
            }).pipe(Stream.unwrap);

          const gradeStream = gradeResultStream.pipe(Stream.catchTag("Retry", makeRetryStream));

          return Stream.empty.pipe(Stream.concat(sessionStream)).pipe(Stream.concat(gradeStream));
        };

        const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
        const trailStream = makeAttemptStream({ session: agentSession, prompt, sessionIdx: 0 });

        const schedMetricEvents = Stream.mergeAll(schedMetricStreams, {
          concurrency: "unbounded",
        }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ ...trailFields, ...result })));

        return Stream.empty.pipe(Stream.concat(trailStream), Stream.merge(schedMetricEvents));
      },
      (effect, trailIdx) =>
        effect.pipe(Stream.unwrap).pipe(
          Stream.catchIf(
            (error) => !Cause.isDone(error),
            (error) => Stream.fail(Event.TrailErrorEvent.make({ ...taskFields, trailIdx, error })),
          ),
        ),
    );

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        ...taskFields,
        metrics: taskMetrics.map((metric) => metric.metadata),
        trajMetrics: trajMetrics.map((metric) => metric.metadata),
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
        task: task.metadata,
      }),
    );

    const trailQueue = yield* Queue.make<Event.EvalEvent, Event.EvalErrorEvent | Cause.Done>();
    // join all fibers instead of interrupt when releasing
    const trailFibers = yield* Effect.acquireRelease(
      FiberSet.make<void, never>(),
      FiberSet.awaitEmpty,
    );

    for (const trailIdx of Array.range(0, trailCount - 1)) {
      yield* makeTrailStream(trailIdx)
        .pipe(
          Stream.catchTag("Done", ({ value: result }) =>
            trailResultPubsub.pipe(PubSub.publish(result)).pipe(() => Stream.empty),
          ),
        )
        .pipe(Stream.runIntoQueue(trailQueue))
        .pipe(trailSem.withPermit)
        .pipe(FiberSet.run(trailFibers));

      // ensure fair scheduling over trails of all tasks
      yield* Effect.yieldNow;
    }

    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ ...taskFields }));

    const trailResultPubsub = yield* PubSub.unbounded<Event.TrailResult>();
    const trailResultsFiber = yield* Stream.fromPubSub(trailResultPubsub).pipe(
      Stream.runCollect,
      Effect.forkScoped,
    );
    const result = Effect.gen(function* () {
      yield* PubSub.shutdown(trailResultPubsub);
      const results = yield* trailResultsFiber.pipe(Fiber.join);
      return yield* Cause.done(Event.TaskResult.make({ trails: results }));
    }).pipe(Stream.fromEffect);

    const trailEvents = Stream.fromQueue(trailQueue);

    const taskMetricStreams = taskMetrics
      .map(Metric.Task.makeStream(Stream.fromPubSub(trailResultPubsub)))
      .map(Stream.mapError(EvalError.metric));
    const taskMetricEvents = Stream.mergeAll(taskMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TaskMetricEvent.make({ ...taskFields, ...result })));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(trailEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
      Stream.merge(taskMetricEvents),
    );
  },
  (effect, options) =>
    effect.pipe(Stream.unwrap).pipe(
      Stream.catchIf(
        (error) => !Cause.isDone(error),
        (error) =>
          makeTaskFields(options)
            .pipe(
              Effect.flatMap((taskFields) =>
                Effect.fail(Event.TaskErrorEvent.make({ ...taskFields, error })),
              ),
            )
            .pipe(Stream.fromEffect),
      ),
    ) satisfies Stream.Stream<
      Event.EvalEvent,
      Event.EvalErrorEvent | Cause.Done<Event.TaskResult>,
      FileSystem.FileSystem | Path.Path | Harness.Service | Sandbox.ProviderService
    >,
);
