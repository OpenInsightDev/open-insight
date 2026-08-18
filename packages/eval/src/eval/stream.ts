import { Harness, Prompt, Sandbox } from "@open-insight/core/internal";
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
  FiberSet,
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

    type TurnEventItem = {
      readonly _tag: "Event";
      readonly event: Event.SessionPromptEvent | Event.SessionStreamEvent;
    };
    type TurnDeltaItem = {
      readonly _tag: "Delta";
      readonly delta: Prompt.Prompt | Prompt.ResponseMessagePart;
    };
    // Build each turn as an actual stream before asking for the next prompt.
    // `Prompt.makeStream` reads the latest trajectory on every pull, so the
    // sequential flatMap below must wait for both response consumers to finish
    // before it pulls the next prompt.
    const turnItems = prompts.pipe(
      Stream.flatMap((prompt) =>
        Effect.gen(function* () {
          const [respStreamForEvent, respStreamForMetric] = yield* makeRespStream(prompt).pipe(
            Stream.broadcastN({ n: 2, capacity: "unbounded" }),
          );

          const eventItems = Stream.empty.pipe(
            Stream.concat(
              Stream.succeed<TurnEventItem>({
                _tag: "Event" as const,
                event: Event.SessionPromptEvent.make({ ...id, prompt }),
              }),
            ),
            Stream.concat(
              respStreamForEvent.pipe(
                Stream.map((part): TurnEventItem => ({
                  _tag: "Event" as const,
                  event: Event.SessionStreamEvent.make({ ...id, part }),
                })),
              ),
            ),
          );
          const deltaItems = Stream.empty.pipe(
            Stream.concat(Stream.succeed<TurnDeltaItem>({ _tag: "Delta" as const, delta: prompt })),
            Stream.concat(
              Prompt.foldResponseStream(respStreamForMetric).pipe(
                Stream.map((delta): TurnDeltaItem => ({ _tag: "Delta" as const, delta })),
              ),
            ),
          );

          // The default merge halt strategy waits for both response branches,
          // ensuring trajectory is committed before the next prompt is pulled.
          return Stream.merge(eventItems, deltaItems);
        }).pipe(Stream.unwrap),
      ),
    );
    const turnStreams = yield* turnItems.pipe(
      Stream.broadcastN({ n: 1 + trajMetrics.length, capacity: "unbounded" }),
    );
    const turnEvents = turnStreams[0]!.pipe(
      Stream.filter((item): item is TurnEventItem => item._tag === "Event"),
      Stream.map((item) => item.event),
    );
    const turnDeltas = turnStreams.slice(1).map((stream) =>
      stream.pipe(
        Stream.filter((item): item is TurnDeltaItem => item._tag === "Delta"),
        Stream.map((item) => item.delta),
      ),
    );
    const metricEventStreams = trajMetrics
      .map((metric, index) =>
        Metric.Traj.makeStream({
          stream: turnDeltas[index]!,
        })(metric),
      )
      .map(Stream.catchTag("MetricError", (error) => Stream.fail(EvalError.metric(error))))
      .map(Stream.map((result) => Event.SessionMetricEvent.make({ ...id, ...result })));
    const metricEvents = Stream.mergeAll(metricEventStreams, { concurrency: "unbounded" });

    const startEvent = Stream.succeed(Event.SessionStartEvent.make(id));
    const endEvent = Ref.get(finishRef)
      .pipe(Effect.map((reason) => Event.SessionEndEvent.make({ ...id, reason })))
      .pipe(Stream.fromEffect);
    const result = Effect.all({
      usage: Ref.get(usageRef),
      trajectory: Ref.get(session.trajectory),
    }).pipe(
      Effect.flatMap(({ usage, trajectory }) =>
        Event.resultDone(Event.SessionResult.make({ usage, trajectory })),
      ),
      Stream.fromEffect,
    );

    const activeEvents = turnEvents.pipe(Stream.merge(metricEvents));
    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
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
}>;

type TrailResultEntry = readonly [trailIdx: number, result: Event.TrailResult];

const makeTrail = Effect.fn(
  function* <T extends Task.AnyTask>({ task, id }: TrailOptions<T>) {
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
    const trailResultRef = yield* Ref.make<Option.Option<Event.TrailResult>>(Option.none());

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
      Event.EvalErrorEvent | EvalError | Event.ResultDone<Event.TrailResult>,
      FileSystem.FileSystem | Path.Path | Grade.RunService
    > => {
      const sessionID = { ...id, sessionIdx };

      const sessionStream = makeSession<T>({ id: sessionID, task, prompt, sbxPromise }).pipe(
        Stream.provideService(Harness.AgentService, session),
        Stream.catchTag("ResultDone", ({ value: result }) =>
          Effect.gen(function* () {
            // Keep the final session usage available for the trail end event.
            yield* Ref.set(usageRef, result.usage);
            yield* Queue.offer(sessionResultQueue, result);
            return Stream.empty;
          }).pipe(Stream.unwrap),
        ),
      );

      const gradeResultStream = Effect.gen(function* () {
        const trajectory = yield* Ref.get(session.trajectory);

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
            Effect.flatMap((sessions) =>
              Event.resultDone(Event.TrailResult.make({ grade, sessions })),
            ),
          )
          .pipe(Stream.fromEffect);

        return result;
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
    const startEvent = Stream.succeed(Event.TrailStartEvent.make(id));
    const attemptStream = makeAttempt({ session: agentSession, prompt, sessionIdx: 0 });
    const attemptEvents = attemptStream.pipe(
      Stream.catchTag("ResultDone", ({ value }) =>
        Ref.set(trailResultRef, Option.some(value)).pipe(Effect.as(Stream.empty), Stream.unwrap),
      ),
    );

    const schedMetricEvents = Stream.mergeAll(schedMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TrailMetricEvent.make({ ...id, ...result })));

    const activeEvents = attemptEvents.pipe(
      Stream.merge(schedMetricEvents, { haltStrategy: "left" }),
    );
    const completion = Effect.gen(function* () {
      const resultOption = yield* Ref.get(trailResultRef);
      if (Option.isNone(resultOption)) {
        return yield* Effect.die("Trail completed without producing a result.");
      }

      const result = resultOption.value;
      const usage = yield* Ref.get(usageRef);
      const endEvent = Stream.succeed(
        Event.TrailEndEvent.make({ ...id, grade: result.grade, usage }),
      );
      const resultDone = Stream.fromEffect(Event.resultDone(result));
      return Stream.empty.pipe(Stream.concat(endEvent), Stream.concat(resultDone));
    }).pipe(Stream.unwrap);

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(completion),
    );
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
    const trailFibers = yield* FiberSet.make<void, never>();

    // Each consumer gets its own queue. This keeps result fan-out lossless even
    // when a metric starts after a trail has completed, and lets every consumer
    // drain buffered results before the queue is ended.
    const trailResultQueues = yield* Effect.all([
      Queue.make<TrailResultEntry, Cause.Done>(),
      ...taskMetrics.map(() => Queue.make<TrailResultEntry, Cause.Done>()),
    ]);
    const trailResultQueue = trailResultQueues[0]!;
    const taskMetricQueues = trailResultQueues.slice(1);

    for (let trailIdx = 0; trailIdx < trailCount; trailIdx += 1) {
      const trailID = { ...id, trailIdx };
      yield* makeTrail<T>({ task, id: trailID })
        .pipe(Stream.provide(runGrader), Stream.provideService(Harness.SnapService, snapSession))
        .pipe(
          Stream.catchTag("GradeError", (error) => Stream.fail(EvalError.grade(error))),
          Stream.catchTag("ResultDone", ({ value: result }) =>
            Effect.forEach(
              trailResultQueues,
              (queue) => Queue.offer(queue, [trailID.trailIdx, result] as const),
              { discard: true },
            ).pipe(Effect.as(Stream.empty), Stream.unwrap),
          ),
        )
        .pipe(
          // `runIntoQueue` ends its queue whenever this stream completes. Trails
          // share one queue, so offer manually and close it once all fibers finish.
          Stream.runForEach((event) => Queue.offer(trailQueue, event)),
          Effect.catchCause((cause) => Queue.failCause(trailQueue, cause)),
          Effect.asVoid,
        )
        .pipe(trailSem.withPermit)
        .pipe(FiberSet.run(trailFibers));

      // ensure fair scheduling over trails of all tasks
      yield* Effect.yieldNow;
    }

    yield* Effect.forkScoped(
      FiberSet.awaitEmpty(trailFibers).pipe(
        Effect.andThen(Queue.end(trailQueue)),
        Effect.andThen(
          Effect.forEach(trailResultQueues, (queue) => Queue.end(queue), { discard: true }),
        ),
      ),
      { startImmediately: true },
    );

    const endEvent = Stream.succeed(Event.TaskEndEvent.make(id));

    const result = Stream.fromEffect(
      Stream.fromQueue(trailResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) => {
            const trails = entries
              .slice()
              .sort(([left], [right]) => left - right)
              .map(([, trail]) => trail);
            return Event.resultDone(Event.TaskResult.make({ trails }));
          }),
        ),
    );

    const trailEvents = Stream.fromQueue(trailQueue);

    const taskMetricStreams = taskMetrics
      .map((metric, index) =>
        Metric.Task.makeStream(
          Stream.fromQueue(taskMetricQueues[index]!).pipe(Stream.map(([, result]) => result)),
        )(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const taskMetricEvents = Stream.mergeAll(taskMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.TaskMetricEvent.make({ ...id, ...result })));

    const activeEvents = trailEvents.pipe(Stream.merge(taskMetricEvents));
    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
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

    const invalidConcurrency = [
      { name: "trailConcurrency", value: trailConcurrency },
      { name: "snapshotConcurrency", value: snapshotConcurrency },
    ].find(({ value }) => !Number.isSafeInteger(value) || value < 1);
    if (invalidConcurrency !== undefined) {
      const { name, value } = invalidConcurrency;
      return yield* Effect.fail(
        EvalError.init(new RangeError(`${name} must be a positive integer (received ${value})`)),
      );
    }
    if (!Number.isSafeInteger(trailCount)) {
      return yield* Effect.fail(
        EvalError.init(new RangeError(`trailCount must be an integer (received ${trailCount})`)),
      );
    }

    const harness = yield* Harness.Service;
    const id: Event.BenchID = {
      harnessId: harness.metadata.id,
      benchId: bench.metadata.id,
    };

    const trailSem = yield* Semaphore.make(trailConcurrency);
    const snapSem = yield* Semaphore.make(snapshotConcurrency);

    // Fan out each completed task to an independent collector/metric queue.
    // Unbounded queues retain values for consumers that are started later and
    // explicit end signals allow partial results when a task fails.
    const taskResultQueues = yield* Effect.all([
      Queue.make<[Task.ID, Metric.Task.TrailResults], Cause.Done>(),
      ...metrics.map(() => Queue.make<[Task.ID, Metric.Task.TrailResults], Cause.Done>()),
    ]);
    const taskResultQueue = taskResultQueues[0]!;
    const benchMetricQueues = taskResultQueues.slice(1);

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
        Stream.catchTag("ResultDone", ({ value: result }) =>
          Effect.forEach(
            taskResultQueues,
            (queue) => Queue.offer(queue, [task.metadata.id, result.trails] as const),
            { discard: true },
          ).pipe(Effect.as(Stream.empty), Stream.unwrap),
        ),
      ),
    );
    const mergedTaskEvents =
      tasks.length === 0
        ? Stream.empty
        : Stream.mergeAll(taskStreams, { concurrency: tasks.length });

    // End all task-result consumers only after every task stream has finished.
    // Values already queued remain available to consumers before completion.
    const mergedTaskEventsWithClose = mergedTaskEvents.pipe(
      Stream.ensuring(
        Effect.forEach(taskResultQueues, (queue) => Queue.end(queue), { discard: true }),
      ),
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

    const result = Stream.fromEffect(
      Stream.fromQueue(taskResultQueue)
        .pipe(Stream.runCollect)
        .pipe(
          Effect.flatMap((entries) => {
            const tasks = pipe(
              entries.map(
                ([taskId, trails]) => [taskId, Event.TaskResult.make({ trails })] as const,
              ),
              Object.fromEntries<Event.TaskResult>,
            );
            return Event.resultDone(Event.BenchResult.make({ tasks }));
          }),
        ),
    );

    const benchMetricStreams = metrics
      .map((metric, index) =>
        Metric.Bench.makeStream(Stream.fromQueue(benchMetricQueues[index]!))(metric),
      )
      .map(Stream.mapError(EvalError.metric));
    const benchMetricEvents = Stream.mergeAll(benchMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.BenchMetricEvent.make({ ...id, ...result })));

    const activeEvents = mergedTaskEventsWithClose.pipe(Stream.merge(benchMetricEvents));
    const stream = Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(activeEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
    );

    if (Option.isSome(persist)) {
      const persistQueue = yield* Queue.make<
        Stream.Success<typeof stream>,
        Stream.Error<typeof stream> | Cause.Done
      >();
      const persistStream = Stream.fromQueue(persistQueue);

      const fiber = yield* persist.value
        .persist(persistStream)
        .pipe(Effect.catchTag("EventError", (error) => Effect.fail(EvalError.event(error))))
        .pipe(Effect.forkScoped);

      // Tee events through an independent queue so the main stream can signal
      // termination before joining the sink. This avoids circular waits between
      // two broadcast subscribers on failure-channel terminal signals.
      return stream.pipe(
        Stream.tap((event) => Queue.offer(persistQueue, event)),
        Stream.catch((error) =>
          Queue.fail(persistQueue, error).pipe(
            Effect.andThen(Fiber.join(fiber)),
            Effect.andThen(Effect.fail(error)),
            Stream.fromEffect,
          ),
        ),
        Stream.onEnd(Queue.end(persistQueue).pipe(Effect.andThen(Fiber.join(fiber)))),
      );
    } else {
      return stream;
    }
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
          return yield* Effect.fail(Event.BenchErrorEvent.make({ ...id, error }));
        }).pipe(Stream.fromEffect),
      ),
    ),
);
