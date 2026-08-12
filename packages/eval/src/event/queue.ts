import { type Cause, Effect, Queue, type Stream } from "effect";
import { EvalEvent } from "./schema.ts";
import type { EventError } from "./error.ts";

export type EventQueue = Queue.Queue<EvalEvent, EventError | Cause.Done>;
export type EventEnqueue = Queue.Enqueue<EvalEvent, EventError | Cause.Done>;
export type EventDequeue = Queue.Dequeue<EvalEvent, EventError | Cause.Done>;
export type EventStream = Stream.Stream<EvalEvent, EventError>;

export const makeQueue = (capacity: number = 1024) =>
  Queue.make<EvalEvent, EventError | Cause.Done>({ capacity });

export const offerTo = (enqueue: EventEnqueue) => (event: Effect.Effect<EvalEvent, unknown>) =>
  event.pipe(Effect.flatMap((event) => Queue.offer(enqueue, event))).pipe(Effect.orDie); // HACK for internal use only
