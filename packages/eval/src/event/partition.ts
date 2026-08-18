import { Schema, Stream } from "effect";
import { TaskID, type SessionID, type TrailID } from "./schema.ts";
import type {
  EvalEventStream,
  SessionEventStream,
  TaskEventStream,
  TrailEventStream,
} from "./stream.ts";

export const filterTask =
  (id: TaskID) =>
  <E, R>(stream: EvalEventStream<E, R>): TaskEventStream<E, R> => {
    return Stream.filter(
      stream,
      (event) =>
        Schema.is(TaskID)(event.id) &&
        event.id.benchId === id.benchId &&
        event.id.harnessId === id.harnessId &&
        event.id.taskId === id.taskId,
    ) as TaskEventStream<E, R>;
  };

export const filterTrail =
  (id: TrailID) =>
  <E, R>(stream: TaskEventStream<E, R>): TrailEventStream<E, R> => {
    throw new Error("Not implemented");
  };

export const filterSession =
  (id: SessionID) =>
  <E, R>(stream: TrailEventStream<E, R>): SessionEventStream<E, R> => {
    throw new Error("Not implemented");
  };
