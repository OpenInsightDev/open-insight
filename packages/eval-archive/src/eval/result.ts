import {
  Cause,
  Chunk,
  Effect,
  Fiber,
  Match,
  MutableHashMap,
  Option,
  Queue,
  Schema,
  Sink,
  Scope,
  Stream,
} from "effect";
import * as Event from "#/event/index.ts";
import * as Task from "#/task/index.ts";
import { Prompt, Response } from "@open-insight/core/internal";
import { EvalError } from "./error.ts";

export const makeTrajSink = (
  id: Event.SessionID,
): Sink.Sink<Prompt.Trajectory, Event.EvalEvent, Event.EvalEvent, never> => {
  const equalSessionID = Schema.toEquivalence(Event.SessionID);
  return Sink.fold(
    () => ({
      traj: Prompt.empty as Prompt.Trajectory,
      parts: Chunk.empty<Response.AnyPart>(),
    }),
    () => true,
    (
      state: { traj: Prompt.Trajectory; parts: Chunk.Chunk<Response.AnyPart> },
      event: Event.EvalEvent,
    ) =>
      Effect.sync(() => {
        // Filter events that don't belong to this session
        if (
          !Match.value(event).pipe(
            Match.tag("SessionPromptEvent", "SessionStreamEvent", "SessionEndEvent", (e) =>
              equalSessionID(e.id, id),
            ),
            Match.orElse(() => false),
          )
        ) {
          return state;
        }

        return Match.value(event).pipe(
          Match.tag("SessionPromptEvent", (e) => ({
            traj:
              state.parts.length > 0
                ? state.traj
                    .pipe(
                      Prompt.concat(Prompt.fromResponseParts(Chunk.toReadonlyArray(state.parts))),
                    )
                    .pipe(Prompt.concat(e.prompt))
                : state.traj.pipe(Prompt.concat(e.prompt)),
            parts: Chunk.empty<Response.AnyPart>(),
          })),
          Match.tag("SessionStreamEvent", (e) => ({
            traj: state.traj,
            parts: Chunk.append(state.parts, e.part),
          })),
          Match.tag("SessionEndEvent", () => ({
            traj:
              state.parts.length > 0
                ? state.traj.pipe(
                    Prompt.concat(Prompt.fromResponseParts(Chunk.toReadonlyArray(state.parts))),
                  )
                : state.traj,
            parts: Chunk.empty<Response.AnyPart>(),
          })),
          Match.orElse(() => state),
        );
      }),
  ).pipe(Sink.map((state) => state.traj));
};

type ResultBranch<A, E> = Readonly<{
  queue: Queue.Queue<E, Cause.Done>;
  fiber: Fiber.Fiber<A, EvalError>;
}>;

const equalBenchID = Schema.toEquivalence(Event.BenchID);

const invalidEvent = (message: string): Effect.Effect<never, EvalError> =>
  Effect.fail(EvalError.event(Event.EventError.invalid(new Error(message))));

const failEvent = (error: unknown): Effect.Effect<never, EvalError> =>
  Effect.fail(
    Schema.is(EvalError)(error) ? error : EvalError.event(Event.EventError.invalid(error)),
  );

const forkResultSink = Effect.fn("forkResultSink")(function* <A, E>(
  sink: Sink.Sink<A, E, never, EvalError>,
): Effect.fn.Return<ResultBranch<A, E>, never, Scope.Scope> {
  const queue = yield* Queue.unbounded<E, Cause.Done>();
  const fiber = yield* Stream.fromQueue(queue).pipe(Stream.run(sink), Effect.forkScoped);
  return { queue, fiber };
});

const closeResultBranch = Effect.fn("closeResultBranch")(function* <A, E>(
  branch: ResultBranch<A, E>,
): Effect.fn.Return<A, EvalError> {
  yield* Queue.end(branch.queue);
  return yield* Fiber.join(branch.fiber);
});

const makeEventSink = <A, E>(
  consume: (event: E) => Effect.Effect<void, EvalError, Scope.Scope>,
  result: Effect.Effect<A, EvalError>,
): Sink.Sink<A, E, never, EvalError> =>
  Sink.fromTransform<E, A, EvalError, never, never>((upstream, scope) =>
    Stream.fromPull(Effect.succeed(upstream)).pipe(
      Stream.runForEach(consume),
      Effect.andThen(result),
      Effect.map((value) => [value] as const),
      Scope.provide(scope),
    ),
  );

// Helper to forward events to a child branch's queue
const forwardToChild = <E, K>(
  key: K,
  active: MutableHashMap.MutableHashMap<K, ResultBranch<unknown, E>>,
  event: E,
  errorMessage: string,
) =>
  Effect.gen(function* () {
    const branch = MutableHashMap.get(active, key);
    if (Option.isNone(branch)) {
      return yield* invalidEvent(errorMessage);
    }
    yield* Queue.offer(branch.value.queue, event);
  });

// Helper to finish a child branch and collect its result
const finishChild = <A, E, K>(
  key: K,
  active: MutableHashMap.MutableHashMap<K, ResultBranch<A, E>>,
  completed: MutableHashMap.MutableHashMap<K, A>,
  event: E,
  errorMessage: string,
) =>
  Effect.gen(function* () {
    const branch = MutableHashMap.get(active, key);
    if (Option.isNone(branch)) {
      return yield* invalidEvent(errorMessage);
    }
    yield* Queue.offer(branch.value.queue, event);
    const result = yield* closeResultBranch(branch.value);
    MutableHashMap.set(completed, key, result);
    MutableHashMap.remove(active, key);
  });

export const makeSessionResultSink = (
  id: Event.SessionID,
): Sink.Sink<Event.SessionResult, Event.SessionEvent, never, EvalError> =>
  Sink.suspend(() => {
    let startedAt: Event.SessionResult["startedAt"] | undefined;
    let end: Event.SessionEndEvent | undefined;

    const consume = Effect.fn("makeSessionResultSink.consume")(function* (
      event: Event.SessionEvent,
    ): Effect.fn.Return<void, EvalError, Scope.Scope> {
      return yield* Match.value(event).pipe(
        Match.tagsExhaustive({
          SessionStartEvent: (event) =>
            startedAt === undefined && end === undefined
              ? Effect.sync(() => {
                  startedAt = event.startAt;
                })
              : invalidEvent("SessionStartEvent is duplicated"),
          SessionPromptEvent: () =>
            startedAt === undefined
              ? invalidEvent("SessionPromptEvent precedes SessionStartEvent")
              : end !== undefined
                ? invalidEvent("SessionPromptEvent follows SessionEndEvent")
                : Effect.void,
          SessionStreamEvent: () =>
            startedAt === undefined
              ? invalidEvent("SessionStreamEvent precedes SessionStartEvent")
              : end !== undefined
                ? invalidEvent("SessionStreamEvent follows SessionEndEvent")
                : Effect.void,
          SessionRetryEvent: () =>
            end === undefined
              ? invalidEvent("SessionRetryEvent precedes SessionEndEvent")
              : Effect.void,
          SessionEndEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("SessionEndEvent precedes SessionStartEvent")
              : end !== undefined
                ? invalidEvent("SessionEndEvent is duplicated")
                : Effect.sync(() => {
                    end = event;
                  }),
          SessionMetricEvent: () =>
            startedAt === undefined
              ? invalidEvent("SessionMetricEvent precedes SessionStartEvent")
              : Effect.void,
          SessionErrorEvent: (event) => failEvent(event.error),
          SessionMetricErrorEvent: (event) => failEvent(event.error),
        }),
      );
    });

    return Sink.fromTransform<Event.SessionEvent, Event.SessionResult, EvalError, never, never>(
      (upstream, scope) =>
        Effect.gen(function* () {
          const source = Stream.fromPull(Effect.succeed(upstream));
          const [trajectoryEvents, resultEvents] = yield* Stream.broadcastN(source, {
            n: 2,
            capacity: "unbounded",
          });
          const { trajectory } = yield* Effect.all(
            {
              trajectory: Stream.run(trajectoryEvents, makeTrajSink(id)),
              consumed: Stream.runForEach(resultEvents, consume),
            },
            { concurrency: "unbounded" },
          );

          if (startedAt === undefined || end === undefined) {
            return yield* invalidEvent("Session stream ended before SessionEndEvent");
          }

          return [
            Event.SessionResult.make({
              id,
              startedAt,
              finishedAt: end.endAt,
              usage: end.usage,
              trajectory,
            }),
          ] as const;
        }).pipe(Scope.provide(scope)),
    );
  });

export const makeTrailResultSink = <G = unknown>(
  id: Event.TrailID,
): Sink.Sink<Event.TrailResult<G>, Event.TrailEvent, never, EvalError> =>
  Sink.suspend(() => {
    const active = MutableHashMap.empty<
      number,
      ResultBranch<Event.SessionResult, Event.SessionEvent>
    >();
    const sessions = MutableHashMap.empty<number, Event.SessionResult>();
    let startedAt: Event.TrailResult<G>["startedAt"] | undefined;
    let end: Event.TrailEndEvent | undefined;

    const forwardSession = Effect.fn("makeTrailResultSink.forwardSession")(function* (
      event: Event.SessionStartEvent | Event.SessionPromptEvent | Event.SessionStreamEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("Session event occurred outside an active trail");
      }
      yield* forwardToChild(
        event.id.sessionIdx,
        active,
        event,
        "Session event has no active session",
      );
    });

    const finishSession = Effect.fn("makeTrailResultSink.finishSession")(function* (
      event: Event.SessionEndEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("SessionEndEvent occurred outside an active trail");
      }
      yield* finishChild(
        event.id.sessionIdx,
        active,
        sessions,
        event,
        "SessionEndEvent has no active session",
      );
    });

    const consume = Effect.fn("makeTrailResultSink.consume")(function* (
      event: Event.TrailEvent,
    ): Effect.fn.Return<void, EvalError, Scope.Scope> {
      return yield* Match.value(event).pipe(
        Match.tagsExhaustive({
          TrailStartEvent: (event) =>
            startedAt === undefined && end === undefined
              ? Effect.sync(() => {
                  startedAt = event.startAt;
                })
              : invalidEvent("TrailStartEvent is duplicated"),
          SessionStartEvent: (event) =>
            Effect.gen(function* () {
              if (startedAt === undefined || end !== undefined) {
                return yield* invalidEvent("SessionStartEvent occurred outside an active trail");
              }
              if (
                MutableHashMap.has(active, event.id.sessionIdx) ||
                MutableHashMap.has(sessions, event.id.sessionIdx)
              ) {
                return yield* invalidEvent("SessionStartEvent is duplicated");
              }
              const branch = yield* forkResultSink(makeSessionResultSink(event.id));
              MutableHashMap.set(active, event.id.sessionIdx, branch);
              yield* Queue.offer(branch.queue, event);
            }),
          SessionPromptEvent: forwardSession,
          SessionStreamEvent: forwardSession,
          SessionRetryEvent: (event) =>
            startedAt === undefined || end !== undefined
              ? invalidEvent("SessionRetryEvent occurred outside an active trail")
              : MutableHashMap.has(sessions, event.id.sessionIdx)
                ? Effect.void
                : invalidEvent("SessionRetryEvent has no completed session"),
          SessionEndEvent: finishSession,
          SessionMetricEvent: (event) =>
            startedAt === undefined || end !== undefined
              ? invalidEvent("SessionMetricEvent occurred outside an active trail")
              : MutableHashMap.has(active, event.id.sessionIdx) ||
                  MutableHashMap.has(sessions, event.id.sessionIdx)
                ? Effect.void
                : invalidEvent("SessionMetricEvent has no known session"),
          TrailEndEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("TrailEndEvent precedes TrailStartEvent")
              : end !== undefined
                ? invalidEvent("TrailEndEvent is duplicated")
                : MutableHashMap.size(active) > 0
                  ? invalidEvent("TrailEndEvent has active sessions")
                  : Effect.sync(() => {
                      end = event;
                    }),
          TrailMetricEvent: () =>
            startedAt === undefined
              ? invalidEvent("TrailMetricEvent precedes TrailStartEvent")
              : Effect.void,
          SessionErrorEvent: (event) => failEvent(event.error),
          SessionMetricErrorEvent: (event) => failEvent(event.error),
          TrailErrorEvent: (event) => failEvent(event.error),
          TrailMetricErrorEvent: (event) => failEvent(event.error),
        }),
      );
    });

    const result = Effect.gen(function* () {
      if (startedAt === undefined || end === undefined) {
        return yield* invalidEvent("Trail stream ended before TrailEndEvent");
      }
      return Event.TrailResult.make({
        id,
        startedAt,
        finishedAt: end.endAt,
        grade: end.grade,
        sessions: Array.from(MutableHashMap.values(sessions)),
      }) as Event.TrailResult<G>;
    });

    return makeEventSink(consume, result);
  });

export const makeTaskResultSink = <G = unknown>(
  id: Event.TaskID,
): Sink.Sink<Event.TaskResult<G>, Event.TaskEvent, never, EvalError> =>
  Sink.suspend(() => {
    const active = MutableHashMap.empty<
      number,
      ResultBranch<Event.TrailResult<G>, Event.TrailEvent>
    >();
    const trails = MutableHashMap.empty<number, Event.TrailResult<G>>();
    let startedAt: Event.TaskResult<G>["startedAt"] | undefined;
    let end: Event.TaskEndEvent | undefined;

    const forwardTrail = Effect.fn("makeTaskResultSink.forwardTrail")(function* (
      event: Event.TrailSuccessEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("Trail event occurred outside an active task");
      }
      yield* forwardToChild(event.id.trailIdx, active, event, "Trail event has no active trail");
    });

    const finishTrail = Effect.fn("makeTaskResultSink.finishTrail")(function* (
      event: Event.TrailEndEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("TrailEndEvent occurred outside an active task");
      }
      yield* finishChild(
        event.id.trailIdx,
        active,
        trails,
        event,
        "TrailEndEvent has no active trail",
      );
    });

    const consume = Effect.fn("makeTaskResultSink.consume")(function* (
      event: Event.TaskEvent,
    ): Effect.fn.Return<void, EvalError, Scope.Scope> {
      return yield* Match.value(event).pipe(
        Match.tagsExhaustive({
          TaskStartEvent: (event) =>
            startedAt === undefined && end === undefined
              ? Effect.sync(() => {
                  startedAt = event.startAt;
                })
              : invalidEvent("TaskStartEvent is duplicated"),
          TrailStartEvent: (event) =>
            Effect.gen(function* () {
              if (startedAt === undefined || end !== undefined) {
                return yield* invalidEvent("TrailStartEvent occurred outside an active task");
              }
              if (
                MutableHashMap.has(active, event.id.trailIdx) ||
                MutableHashMap.has(trails, event.id.trailIdx)
              ) {
                return yield* invalidEvent("TrailStartEvent is duplicated");
              }
              const branch = yield* forkResultSink(makeTrailResultSink<G>(event.id));
              MutableHashMap.set(active, event.id.trailIdx, branch);
              yield* Queue.offer(branch.queue, event);
            }),
          SessionStartEvent: forwardTrail,
          SessionPromptEvent: forwardTrail,
          SessionStreamEvent: forwardTrail,
          SessionRetryEvent: forwardTrail,
          SessionEndEvent: forwardTrail,
          SessionMetricEvent: forwardTrail,
          TrailEndEvent: finishTrail,
          TrailMetricEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("TrailMetricEvent precedes TaskStartEvent")
              : MutableHashMap.has(active, event.id.trailIdx) ||
                  MutableHashMap.has(trails, event.id.trailIdx)
                ? Effect.void
                : invalidEvent("TrailMetricEvent has no known trail"),
          TaskEndEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("TaskEndEvent precedes TaskStartEvent")
              : end !== undefined
                ? invalidEvent("TaskEndEvent is duplicated")
                : MutableHashMap.size(active) > 0
                  ? invalidEvent("TaskEndEvent has active trails")
                  : Effect.sync(() => {
                      end = event;
                    }),
          TaskMetricEvent: () =>
            startedAt === undefined
              ? invalidEvent("TaskMetricEvent precedes TaskStartEvent")
              : Effect.void,
          SessionErrorEvent: (event) => failEvent(event.error),
          SessionMetricErrorEvent: (event) => failEvent(event.error),
          TrailErrorEvent: (event) => failEvent(event.error),
          TrailMetricErrorEvent: (event) => failEvent(event.error),
          TaskErrorEvent: (event) => failEvent(event.error),
          TaskMetricErrorEvent: (event) => failEvent(event.error),
        }),
      );
    });

    const result = Effect.gen(function* () {
      if (startedAt === undefined || end === undefined) {
        return yield* invalidEvent("Task stream ended before TaskEndEvent");
      }
      return Event.TaskResult.make({
        id,
        startedAt,
        finishedAt: end.endAt,
        trails: Array.from(MutableHashMap.values(trails)),
      }) as Event.TaskResult<G>;
    });

    return makeEventSink(consume, result);
  });

export const makeResultSink = <T extends Task.AnyTask>(
  id: Event.BenchID,
): Sink.Sink<Event.BenchResult<Task.GradeTypeOf<T>>, Event.EvalEvent, never, EvalError> =>
  Sink.suspend(() => {
    type Grade = Task.GradeTypeOf<T>;
    const active = MutableHashMap.empty<
      Task.ID,
      ResultBranch<Event.TaskResult<Grade>, Event.TaskEvent>
    >();
    const tasks = MutableHashMap.empty<Task.ID, Event.TaskResult<Grade>>();
    let startedAt: Event.BenchResult<Grade>["startedAt"] | undefined;
    let end: Event.BenchEndEvent | undefined;

    const forwardTask = Effect.fn("makeResultSink.forwardTask")(function* (
      event: Event.TaskSuccessEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("Task event occurred outside an active benchmark");
      }
      yield* forwardToChild(event.id.taskId, active, event, "Task event has no active task");
    });

    const finishTask = Effect.fn("makeResultSink.finishTask")(function* (
      event: Event.TaskEndEvent,
    ): Effect.fn.Return<void, EvalError> {
      if (startedAt === undefined || end !== undefined) {
        return yield* invalidEvent("TaskEndEvent occurred outside an active benchmark");
      }
      yield* finishChild(event.id.taskId, active, tasks, event, "TaskEndEvent has no active task");
    });

    const consume = Effect.fn("makeResultSink.consume")(function* (
      event: Event.EvalEvent,
    ): Effect.fn.Return<void, EvalError, Scope.Scope> {
      if (!equalBenchID(event.id, id)) {
        return;
      }

      return yield* Match.value(event).pipe(
        Match.tagsExhaustive({
          BenchStartEvent: (event) =>
            startedAt === undefined && end === undefined
              ? Effect.sync(() => {
                  startedAt = event.startAt;
                })
              : invalidEvent("BenchStartEvent is duplicated"),
          TaskStartEvent: (event) =>
            Effect.gen(function* () {
              if (startedAt === undefined || end !== undefined) {
                return yield* invalidEvent("TaskStartEvent occurred outside an active benchmark");
              }
              if (
                MutableHashMap.has(active, event.id.taskId) ||
                MutableHashMap.has(tasks, event.id.taskId)
              ) {
                return yield* invalidEvent("TaskStartEvent is duplicated");
              }
              const branch = yield* forkResultSink(makeTaskResultSink<Grade>(event.id));
              MutableHashMap.set(active, event.id.taskId, branch);
              yield* Queue.offer(branch.queue, event);
            }),
          TrailStartEvent: forwardTask,
          SessionStartEvent: forwardTask,
          SessionPromptEvent: forwardTask,
          SessionStreamEvent: forwardTask,
          SessionRetryEvent: forwardTask,
          SessionEndEvent: forwardTask,
          SessionMetricEvent: forwardTask,
          TrailEndEvent: forwardTask,
          TrailMetricEvent: forwardTask,
          TaskEndEvent: finishTask,
          TaskMetricEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("TaskMetricEvent precedes BenchStartEvent")
              : MutableHashMap.has(active, event.id.taskId) ||
                  MutableHashMap.has(tasks, event.id.taskId)
                ? Effect.void
                : invalidEvent("TaskMetricEvent has no known task"),
          BenchEndEvent: (event) =>
            startedAt === undefined
              ? invalidEvent("BenchEndEvent precedes BenchStartEvent")
              : end !== undefined
                ? invalidEvent("BenchEndEvent is duplicated")
                : MutableHashMap.size(active) > 0
                  ? invalidEvent("BenchEndEvent has active tasks")
                  : Effect.sync(() => {
                      end = event;
                    }),
          BenchMetricEvent: () =>
            startedAt === undefined
              ? invalidEvent("BenchMetricEvent precedes BenchStartEvent")
              : Effect.void,
          SessionErrorEvent: (event) => failEvent(event.error),
          SessionMetricErrorEvent: (event) => failEvent(event.error),
          TrailErrorEvent: (event) => failEvent(event.error),
          TrailMetricErrorEvent: (event) => failEvent(event.error),
          TaskErrorEvent: (event) => failEvent(event.error),
          TaskMetricErrorEvent: (event) => failEvent(event.error),
          BenchErrorEvent: (event) => failEvent(event.error),
          BenchMetricErrorEvent: (event) => failEvent(event.error),
        }),
      );
    });

    const result = Effect.gen(function* () {
      if (startedAt === undefined || end === undefined) {
        return yield* invalidEvent("Evaluation stream ended before BenchEndEvent");
      }
      return Event.BenchResult.make({
        id,
        startedAt,
        finishedAt: end.endAt,
        tasks: Object.fromEntries(
          Array.from(MutableHashMap.values(tasks)).map((task) => [task.id.taskId, task]),
        ),
      }) as Event.BenchResult<Grade>;
    });

    return makeEventSink(consume, result);
  });
