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
  Option,
  pipe,
} from "effect";
import * as Bench from "#/bench/index.ts";
import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";

type SessionOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.SessionID;

  task: T;
  prompt: Prompt.Options;
  sbxPromise: Sandbox.SandboxPromise;
}>;

const makeSession = Effect.fn(
  function* <T extends Task.AnyTask>(options: SessionOptions<T>) {
    const { id, prompt, sbxPromise, task } = options;
    const { trajMetrics } = task;

    const session = yield* Harness.AgentService;

    const trajectory = yield* Ref.get(session.trajectory);
    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const makeRespStream = (prompt: Prompt.Prompt) =>
      session
        .prompt(prompt)
        .pipe(Stream.mapError(EvalError.harness))
        .pipe(
          Stream.tap(
            Effect.fn(function* (part) {
              if (part.type !== "finish") {
                return;
              }
              yield* Effect.all([Ref.set(finishRef, part.reason), Ref.set(usageRef, part.usage)]);
            }),
          ),
        );

    const prompts = Prompt.makeStream(prompt, {
      trajectory: session.trajectory,
      sandbox: sbxPromise,
    }).pipe(Stream.mapError(EvalError.taskExec(task, id.trailIdx)));

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
          Stream.map((result) => Event.SessionMetricEvent.make({ ...id, ...result })),
        );

        const promptEvent = Stream.succeed(Event.SessionPromptEvent.make({ ...id, prompt }));
        const streamEvents = respStreamForEvent.pipe(
          Stream.map((part) => Event.SessionStreamEvent.make({ ...id, part })),
        );
        const metricEvents = Stream.mergeAll(metricEventStreams, {
          concurrency: "unbounded",
        });

        return Stream.empty.pipe(
          Stream.concat(promptEvent),
          Stream.concat(streamEvents),
          Stream.merge(metricEvents),
        );
      }).pipe((eff) =>
        eff.pipe(
          Stream.unwrap,
          Stream.catchTag("EvalError", (error) =>
            Stream.fail(Event.SessionErrorEvent.make({ ...id, error })),
          ),
        ),
      );

    const startEvent = Stream.succeed(Event.SessionStartEvent.make(id));

    const trajEvents = prompts.pipe(Stream.flatMap(makeTrajStream));

    const endEvent = Ref.get(finishRef)
      .pipe(Effect.map((reason) => Event.SessionEndEvent.make({ ...id, reason })))
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
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.SessionErrorEvent.make({ ...id, error })),
      ),
    ),
);

type TrailOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.TrailID;

  task: T;
  bench: Bench.Bench<T>;
}>;

const makeTrail = Effect.fn(
  function* <T extends Task.AnyTask>({ task, bench, id }: TrailOptions<T>) {
    const { sandboxConfig, schedMetrics, prompt } = task;

    const { run: runGrader } = yield* Grade.RunService;
    const snapSession = yield* Harness.SnapService;

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getTrail(Event.TrailID.make(id));
      if (Option.isSome(stream)) {
        yield* Effect.logInfo(
          `Trail ${id.trailIdx} for task ${id.taskId} already exists in persist, skipping execution`,
        );
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const sbxSession = yield* snapSession
      .runSandbox(sandboxConfig)
      .pipe(Effect.mapError(EvalError.harness));
    const sandbox = sbxSession.sandbox;
    const sbxPromise = yield* Sandbox.asPromise(sbxSession.sandbox);

    const schedMetricStreams = schedMetrics
      .map(Metric.Sched.makeStream({ sandbox }))
      .map(Stream.mapError(EvalError.metric));

    const usageRef = yield* Ref.make<Response.Usage | null>(null);

    const sessionResultQueue = yield* Queue.make<Event.SessionResult, Cause.Done>();

    const makeAttempt = ({
      session,
      prompt,
      sessionIdx,
    }: {
      session: Harness.AgentSession;
      prompt: Prompt.Options;
      sessionIdx: number;
    }): Stream.Stream<
      Event.EvalSuccessEvent,
      Event.EvalErrorEvent | EvalError | Cause.Done<Event.TrailResult>,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID = { ...id, sessionIdx };

      const sessionStream = makeSession<T>({ id: sessionID, task, prompt, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, session),
        Stream.catchTag("Done", ({ value: result }) =>
          Queue.offer(sessionResultQueue, result).pipe(() => Stream.empty),
        ),
      );

      const gradeResultStream = Effect.gen(function* () {
        const trajectory = yield* Ref.get(session.trajectory);
        const usage = yield* Ref.get(usageRef);

        const grade = yield* runGrader<Task.GradeOf<T>>({
          sandbox: sbxSession.sandbox,
          trajectory,
        }).pipe(
          Effect.catchTag("Retry", (retry) => Effect.fail(retry)),
          Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
        );

        yield* Queue.end(sessionResultQueue);

        const result = Queue.collect(sessionResultQueue)
          .pipe(
            Effect.flatMap((sessions) => Cause.done(Event.TrailResult.make({ grade, sessions }))),
          )
          .pipe(Stream.fromEffect);

        const endEvent = Stream.succeed(Event.TrailEndEvent.make({ ...id, grade, usage }));

        return Stream.empty.pipe(Stream.concat(endEvent), Stream.concat(result));
      }).pipe(Stream.unwrap);

      const makeRetryStream = (retry: Grade.Retry) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `Grader requested a "${retry.type}" retry for trail ${id.trailIdx}: ${retry.reason ?? "unknown reason"}`,
          );

          const nextSession = yield* Match.value(retry.type).pipe(
            Match.when("restart", () =>
              sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness)),
            ),
            Match.when("continue", () => Effect.succeed(session)),
            Match.exhaustive,
          );
          const nextAttempt = makeAttempt({
            session: nextSession,
            prompt: retry.prompt,
            sessionIdx: sessionIdx + 1,
          });

          const retryEvent = Stream.succeed(
            Event.SessionRetryEvent.make({ ...sessionID, reason: retry.reason }),
          );

          return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
        }).pipe(Stream.unwrap);

      const gradeStream = gradeResultStream.pipe(Stream.catchTag("Retry", makeRetryStream));

      return Stream.empty.pipe(Stream.concat(sessionStream), Stream.concat(gradeStream));
    };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const trailStream = makeAttempt({ session: agentSession, prompt, sessionIdx: 0 });

    const schedMetricEvents = Stream.mergeAll(schedMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ ...id, ...result })));

    return Stream.empty.pipe(Stream.concat(trailStream), Stream.merge(schedMetricEvents));
  },
  (eff, { id }) =>
    eff
      .pipe(Stream.unwrap)
      .pipe(
        Stream.catchTag("EvalError", (error) =>
          Stream.fail(Event.TrailErrorEvent.make({ ...id, error })),
        ),
      ),
);

export type TaskOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.TaskID;

  task: T;
  bench: Bench.Bench<T>;
  config: Config;
  snapSem: Semaphore.Semaphore;
  trailSem: Semaphore.Semaphore;
  trailCount: number;
}>;

const makeTask = Effect.fn(
  function* <T extends Task.AnyTask>(options: TaskOptions<T>) {
    const harness = yield* Harness.Service;

    const { id, task, bench, snapSem, trailSem, trailCount } = options;
    const {
      grader,
      snapshot: taskTemplate,
      metrics: taskMetrics,
      trajMetrics,
      schedMetrics,
    } = task;

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getTask(Event.TaskID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const runGrader = Grade.RunService.layerFrom<Task.GradeOf<T>>(grader);

    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        ...id,
        metrics: taskMetrics.map((metric) => metric.metadata),
        trajMetrics: trajMetrics.map((metric) => metric.metadata),
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
        task: task.metadata,
      }),
    );

    const trailQueue = yield* Queue.make<
      Event.EvalSuccessEvent,
      EvalError | Event.EvalErrorEvent | Cause.Done
    >();
    // join all fibers instead of interrupt when releasing
    const trailFibers = yield* Effect.acquireRelease(
      FiberSet.make<void, never>(),
      FiberSet.awaitEmpty,
    );

    const trailResultPubsub = yield* PubSub.unbounded<Event.TrailResult>();

    for (const trailIdx of Array.range(0, trailCount - 1)) {
      yield* makeTrail<T>({ task, bench, id: { ...id, trailIdx } })
        .pipe(Stream.provide(runGrader), Stream.provideService(Harness.SnapService, snapSession))
        .pipe(
          Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
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

    const endEvent = Stream.succeed(Event.TaskEndEvent.make(id));

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
    }).pipe(Stream.map((result) => Event.TaskMetricEvent.make({ ...id, ...result })));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(trailEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
      Stream.merge(taskMetricEvents),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TaskErrorEvent.make({ ...id, error })),
      ),
    ),
);

export const make = Effect.fn(
  function* <T extends Task.AnyTask>(bench: Bench.Bench<T>, config: Config) {
    const { tasks, metrics } = bench;
    const { trailConcurrency, snapshotConcurrency, trailCount } = config;

    const harness = yield* Harness.Service;
    const id: Event.BenchID = {
      harnessId: harness.metadata.id,
      benchId: bench.metadata.id,
    };

    const trailSem = yield* Semaphore.make(trailConcurrency);
    const snapSem = yield* Semaphore.make(snapshotConcurrency);

    const taskResultPubsub = yield* PubSub.unbounded<[Task.ID, Metric.Task.TrailResults]>();
    const taskResultsFiber = yield* Stream.fromPubSub(taskResultPubsub)
      .pipe(Stream.runCollect)
      .pipe(Effect.forkScoped);

    const taskStreams = tasks.map((task) =>
      makeTask<T>({
        id: { ...id, taskId: task.metadata.id },
        bench,
        task,
        config,
        snapSem,
        trailSem,
        trailCount,
      }).pipe(
        Stream.catchTag("Done", ({ value: result }) =>
          PubSub.publish(taskResultPubsub, [task.metadata.id, result.trails] as const).pipe(
            () => Stream.empty,
          ),
        ),
      ),
    );
    const mergedTaskEvents = Stream.mergeAll(taskStreams, { concurrency: tasks.length }).pipe(
      Stream.ensuring(PubSub.shutdown(taskResultPubsub)),
    );

    const persist = yield* Effect.serviceOption(Event.Persist.Service);

    if (Option.isSome(persist)) {
      const stream = persist.value.getBench(Event.BenchID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const startEvent = Stream.succeed(
      Event.BenchStartEvent.make({
        ...id,
        bench: bench.metadata,
        harness: harness.metadata,
        metrics: metrics.map((metric) => metric.metadata),
      }),
    );

    const endEvent = Stream.succeed(Event.BenchEndEvent.make(id));

    const result = taskResultsFiber.pipe(Fiber.join).pipe(
      Effect.map((entries) =>
        pipe(
          entries.map(([id, trails]) => [id, Event.TaskResult.make({ trails })] as const),
          Object.fromEntries<Event.TaskResult>,
        ),
      ),
      Effect.flatMap((tasks) => Cause.done(Event.BenchResult.make({ tasks }))),
      Stream.fromEffect,
    );

    const benchMetricStreams = metrics
      .map(Metric.Bench.makeStream(Stream.fromPubSub(taskResultPubsub)))
      .map(Stream.mapError(EvalError.metric));
    const benchMetricEvents = Stream.mergeAll(benchMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.BenchMetricEvent.make({ ...id, ...result })));

    const stream = Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(mergedTaskEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
      Stream.merge(benchMetricEvents),
    );

    if (Option.isSome(persist)) {
      const [mainStream, persistStream] = yield* stream.pipe(
        Stream.broadcastN({ n: 2, capacity: "unbounded" }),
      );

      const fiber = yield* persist.value
        .persist(persistStream)
        .pipe(Effect.catchTag("EventError", (error) => Effect.fail(EvalError.event(error))))
        .pipe(Effect.forkScoped);

      return mainStream.pipe(Stream.onEnd(Fiber.join(fiber)));
    } else {
      return stream;
    }
  },
  (eff, bench) =>
    eff.pipe(
      Effect.flatMap(
        Effect.fn(function* (stream) {
          const harness = yield* Harness.Service;

          const id: Event.BenchID = {
            harnessId: harness.metadata.id,
            benchId: bench.metadata.id,
          };

          return stream.pipe(Stream.catchTag("EvalError", (error) => error));
        }),
      ),
      Stream.unwrap,
    ),
);
