import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
import { Array, Schema } from "effect";
import { Response } from "@open-insight/core/internal";
import {
  Effect,
  FileSystem,
  Path,
  Ref,
  Semaphore,
  Stream,
  Cause,
  Queue,
  Match,
  Option,
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
  sbxPromise: Sandbox.SandboxPromise;
}>;

const makeSession = Effect.fn(
  function* <T extends Task.AnyTask>(options: SessionOptions<T>) {
    const { id, task } = options;
    const { trajMetrics } = task;

    const session = yield* Harness.AgentService;
    const { init: promptInit, prompt: promptFn } = yield* Prompt.Service;

    const usageRef = yield* Ref.make<Response.Usage | null>(null);
    const finishRef = yield* Ref.make<Response.FinishReason>("unknown");

    const deltaQueue = yield* Queue.make<Prompt.Prompt | Response.AnyAggPart, Cause.Done>();

    const turns = Stream.callback<Prompt.Prompt | Response.AnyStreamPart, EvalError>(
      Effect.fn(function* (queue) {
        let current: Option.Option<Prompt.Prompt> = Option.some(promptInit);

        while (Option.isSome(current)) {
          yield* Effect.all([
            Queue.offer(queue, current.value),
            Queue.offer(deltaQueue, current.value),
          ]);

          const [resp, respForDelta] = yield* session
            .prompt(current.value)
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
            )
            .pipe(Stream.broadcastN({ n: 2, capacity: "unbounded" }));

          yield* Effect.all([
            resp.pipe(Stream.runForEach((part) => Queue.offer(queue, part))),
            respForDelta
              .pipe(Response.fold)
              .pipe(Stream.runForEach((part) => Queue.offer(deltaQueue, part))),
          ]);

          const trajectory = yield* Ref.get(session.trajectory);

          current = yield* promptFn(trajectory).pipe(Effect.mapError(EvalError.prompt));
        }

        yield* Queue.end(queue);
        yield* Queue.end(deltaQueue);
      }),
    );
    const turnEvents = turns.pipe(
      Stream.map((value) =>
        Match.value(value).pipe(
          Match.when(Prompt.isPrompt, (prompt) => Event.SessionPromptEvent.make({ id, prompt })),
          Match.orElse((part) => Event.SessionStreamEvent.make({ id, part })),
        ),
      ),
    );

    const deltas = Stream.fromQueue(deltaQueue);
    const metricEventStreams = trajMetrics
      .map(Metric.Traj.makeStream(deltas))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.SessionMetricEvent.make({ id, ...result })));
    const metricEvents = Stream.mergeAll(metricEventStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(Event.SessionStartEvent.make({ id }));
    const endEvent = Effect.all([Ref.get(finishRef), Ref.get(usageRef)]).pipe(
      Effect.map(([reason, usage]) => Event.SessionEndEvent.make({ id, reason, usage })),
      Stream.fromEffect,
    );

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(turnEvents),
      Stream.concat(endEvent),
      Stream.merge(metricEvents),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.SessionErrorEvent.make({ id, error })),
      ),
    ),
);

type TrailOptions<T extends Task.AnyTask> = Readonly<{
  id: Event.TrailID;
  task: T;
}>;

const makeTrail = Effect.fn(
  function* <T extends Task.AnyTask>({ id, task }: TrailOptions<T>) {
    const { sandboxConfig, schedMetrics, prompt: promptOptions } = task;

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

    const makeAttempt = ({
      agentSession,
      prompt: promptOptions,
      sessionIdx,
    }: {
      agentSession: Harness.AgentSession;
      prompt: Prompt.Options;
      sessionIdx: number;
    }): Stream.Stream<
      Event.EvalSuccessEvent,
      Event.EvalErrorEvent | EvalError,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID: Event.SessionID = { ...id, sessionIdx };

      const session = makeSession<T>({ id: sessionID, task, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, agentSession),
        Stream.provide(
          Prompt.layerFrom({
            options: promptOptions,
            context: sbxPromise,
          }),
        ),
        Stream.catchTag("PromptError", (error) => Stream.fail(EvalError.prompt(error))),
      );

      const gradeResult = Effect.gen(function* () {
        const trajectory = yield* Ref.get(agentSession.trajectory);

        const grade = yield* runGrader<Task.GradeOf<T>>({
          sandbox: sbxSession.sandbox,
          trajectory,
        }).pipe(
          Effect.catchTag("Retry", (retry) => Effect.fail(retry)),
          Effect.catchTag("GradeError", (error) => Effect.fail(EvalError.grade(error))),
        );

        return Stream.succeed(Event.TrailEndEvent.make({ id, grade }));
      }).pipe(Stream.unwrap);

      const makeRetry = (retry: Grade.Retry) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `Grader requested a "${retry.type}" retry for trail ${id.trailIdx}: ${retry.reason ?? "unknown reason"}`,
          );

          const nextSession = yield* Match.value(retry.type).pipe(
            Match.when("restart", () =>
              sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness)),
            ),
            Match.when("continue", () => Effect.succeed(agentSession)),
            Match.exhaustive,
          );
          const nextAttempt = makeAttempt({
            agentSession: nextSession,
            prompt: { init: retry.prompt },
            sessionIdx: sessionIdx + 1,
          });

          const retryEvent = Stream.succeed(
            Event.SessionRetryEvent.make({ id: sessionID, reason: retry.reason }),
          );

          return Stream.empty.pipe(Stream.concat(retryEvent), Stream.concat(nextAttempt));
        }).pipe(Stream.unwrap);

      const gradeStream = gradeResult.pipe(Stream.catchTag("Retry", makeRetry));

      return Stream.empty.pipe(Stream.concat(session), Stream.concat(gradeStream));
    };

    const agentSession = yield* sbxSession.runAgent().pipe(Effect.mapError(EvalError.harness));
    const startEvent = Stream.succeed(Event.TrailStartEvent.make({ id }));
    const attemptEvents = makeAttempt({ agentSession, prompt: promptOptions, sessionIdx: 0 });

    const schedMetricStreams = schedMetrics
      .map(Metric.Sched.makeStream(sandbox))
      .map(Stream.mapError(EvalError.metric));
    const metricEvents = Stream.mergeAll(schedMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ id, ...result })));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(attemptEvents),
      Stream.merge(metricEvents),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TrailErrorEvent.make({ id, error })),
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

    const { id, task, snapSem, trailSem, trailCount } = options;
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

    const snapSession = yield* harness
      .runSnapshot(taskTemplate)
      .pipe(snapSem.withPermit)
      .pipe(Effect.mapError(EvalError.harness));

    const startEvent = Stream.succeed(
      Event.TaskStartEvent.make({
        id,
        taskMetrics: taskMetrics.map((metric) => metric.metadata),
        trajMetrics: trajMetrics.map((metric) => metric.metadata),
        schedMetrics: schedMetrics.map((metric) => metric.metadata),
        task: task.metadata,
      }),
    );

    const [trailEvents, trailEventsForMetric] = yield* Stream.fromArray(
      Array.range(0, trailCount - 1),
    )
      .pipe(
        Stream.flatMap(
          Effect.fn(
            function* (trailIdx) {
              // ensure fair scheduling over trails of all tasks
              yield* Effect.yieldNow;

              return makeTrail<T>({ task, id: { ...id, trailIdx } })
                .pipe(
                  Stream.provide(Grade.RunService.layerFrom<Task.GradeOf<T>>(grader)),
                  Stream.provideService(Harness.SnapService, snapSession),
                )
                .pipe(
                  Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
                );
            },
            (eff) => eff.pipe(trailSem.withPermit, Stream.unwrap),
          ),
        ),
      )
      .pipe(Stream.broadcastN({ n: 2, capacity: "unbounded" }));

    const trailResults = trailEventsForMetric.pipe(
      Stream.filter(Schema.is(Event.TrailEndEvent)),
      Stream.map(({ grade }) => grade),
    );
    const metricStreams = taskMetrics
      .map(Metric.Task.makeStream(trailResults))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.TaskMetricEvent.make({ id, ...result })));
    const metricEvents = Stream.mergeAll(metricStreams, { concurrency: "unbounded" });

    const endEvent = Stream.succeed(Event.TaskEndEvent.make({ id }));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(trailEvents),
      Stream.concat(endEvent),
      Stream.merge(metricEvents),
    );
  },
  (eff, { id }) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Stream.fail(Event.TaskErrorEvent.make({ id, error })),
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

    const persist = yield* Effect.serviceOption(Event.Persist.Service);
    if (Option.isSome(persist)) {
      const stream = persist.value.getBench(Event.BenchID.make(id));
      if (Option.isSome(stream)) {
        return stream.value.pipe(
          Stream.catchTag("EventError", (error) => Stream.fail(EvalError.event(error))),
        );
      }
    }

    const taskStreams = tasks.map((task) =>
      makeTask<T>({
        id: { ...id, taskId: task.metadata.id },
        bench,
        task,
        config,
        snapSem,
        trailSem,
        trailCount,
      }),
    );
    const [taskEvents, taskEventsForMetric] = yield* Stream.mergeAll(taskStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.broadcastN({ n: 2, capacity: "unbounded" }));

    const deltas = taskEventsForMetric.pipe(
      Stream.filter(Schema.is(Event.TrailEndEvent)),
      Stream.map(({ grade, id: { taskId } }) => [taskId, grade as Task.GradeTypeOf<T>] as const),
    );
    const metricStreams = metrics
      .map(Metric.Bench.makeStream(deltas))
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.BenchMetricEvent.make({ id, ...result })));
    const metricEvents = Stream.mergeAll(metricStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(
      Event.BenchStartEvent.make({
        id,
        bench: bench.metadata,
        harness: harness.metadata,
        metrics: metrics.map((metric) => metric.metadata),
      }),
    );

    const endEvent = Stream.succeed(Event.BenchEndEvent.make({ id }));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(taskEvents),
      Stream.concat(endEvent),
      Stream.merge(metricEvents),
    );
  },
  (eff, bench) =>
    eff.pipe(
      Stream.unwrap,
      Stream.catchTag("EvalError", (error) =>
        Effect.gen(function* () {
          const harness = yield* Harness.Service;
          const id: Event.BenchID = {
            harnessId: harness.metadata.id,
            benchId: bench.metadata.id,
          };
          return yield* Effect.fail(Event.BenchErrorEvent.make({ id, error }));
        }).pipe(Stream.fromEffect),
      ),
    ),
);
