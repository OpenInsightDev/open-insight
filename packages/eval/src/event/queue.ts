import { type Cause, Effect, Queue, type Stream } from "effect";
import { Event } from "./schema.ts";
import type { Error } from "./error.ts";
import type { SchemaError } from "effect/SchemaError";

export type EventQueue = Queue.Queue<Event, Error | Cause.Done>;
export type EventEnqueue = Queue.Enqueue<Event, Error | Cause.Done>;
export type EventStream = Stream.Stream<Event, Error>;

export const makeQueue = (capacity: number = 1024) =>
  Queue.make<Event, Error | Cause.Done>({ capacity });

export const offerTo = (enqueue: EventEnqueue) => (event: Effect.Effect<Event, SchemaError>) =>
  event.pipe(Effect.flatMap((event) => Queue.offer(enqueue, event))).pipe(Effect.orDie); // HACK for internal use only
