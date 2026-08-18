import type { Stream } from "effect";
import type { EvalEvent, SessionEvent, TaskEvent, TrailEvent } from "./schema.ts";

export type EvalEventStream<E, R> = Stream.Stream<EvalEvent, E, R>;
export type TaskEventStream<E, R> = Stream.Stream<TaskEvent, E, R>;
export type TrailEventStream<E, R> = Stream.Stream<TrailEvent, E, R>;
export type SessionEventStream<E, R> = Stream.Stream<SessionEvent, E, R>;
