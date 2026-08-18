import type { SessionID, TaskID, TrailID } from "./schema.ts";
import type {
  EvalEventStream,
  SessionEventStream,
  TaskEventStream,
  TrailEventStream,
} from "./stream.ts";

export const filterTask =
  (id: TaskID) =>
  <E, R>(stream: EvalEventStream<E, R>): TaskEventStream<E, R> => {
    throw new Error("Not implemented");
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
