import { Effect, Equal, Schema, Stream } from "effect";
import { TaskID, type SessionID, type TrailID } from "./schema.ts";
import type {
  EvalEventStream,
  SessionEventStream,
  TaskEventStream,
  TrailEventStream,
} from "./stream.ts";

const decodeTaskId = Schema.decodeUnknownEffect(TaskID);

export const filterTask =
  (id: TaskID) =>
  <E, R>(stream: EvalEventStream<E, R>): TaskEventStream<E, R> => {
    return Stream.filterEffect(stream, (event) =>
      decodeTaskId(event).pipe(
        Effect.map((decoded) => Equal.equals(decoded, id)),
        Effect.orElseSucceed(() => false),
      ),
    ) as TaskEventStream<E, R>;
  };

export const filterTrail =
  (_id: TrailID) =>
  <E, R>(_stream: TaskEventStream<E, R>): TrailEventStream<E, R> => {
    throw new Error("Not implemented");
  };

export const filterSession =
  (_id: SessionID) =>
  <E, R>(_stream: TrailEventStream<E, R>): SessionEventStream<E, R> => {
    throw new Error("Not implemented");
  };
