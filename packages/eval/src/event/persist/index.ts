import { Effect, Layer, Schema, Stream } from "effect";
import { EventJournal, SqlEventJournal } from "effect/unstable/eventlog";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Event } from "../schema.ts";
import { EventError } from "../error.ts";
import type { Persist } from "./schema.ts";
import { Service } from "./service.ts";
import type { EventStream } from "../queue.ts";

export * from "./schema.ts";
export * from "./service.ts";

const encode = Schema.encodeEffect(Event);

const encoder = new TextEncoder();

/**
 * Derives a stable identifying key for an event, based on the identity fields
 * that distinguish the evaluation scope it belongs to (bench/harness/task/trail).
 *
 * This is used as the journal `primaryKey`; refine it if you need per-event
 * uniqueness or a different grouping.
 */
export const primaryKey = (event: Event): string => {
  switch (event._tag) {
    case "EvalStartEvent":
    case "EvalEndEvent":
    case "EvalErrorEvent":
    case "BenchMetricEvent":
      return `${event.benchId}:${event.harnessId}`;
    case "TaskStartEvent":
    case "TaskEndEvent":
    case "TaskErrorEvent":
    case "TaskMetricEvent":
      return `${event.benchId}:${event.harnessId}:${event.taskId}`;
    case "TrailStartEvent":
    case "TrailEndEvent":
    case "TrailErrorEvent":
    case "SessionPromptEvent":
    case "SessionErrorEvent":
    case "SessionStreamEvent":
    case "TrajMetricEvent":
      return `${event.benchId}:${event.harnessId}:${event.taskId}:${event.trailIdx}`;
  }
};

/**
 * Creates a `Persist` backed by the `EventJournal` service.
 *
 * Each event of the stream is encoded with the `Event` schema, serialized to
 * JSON bytes, and committed to the journal via `EventJournal.write`, keyed by
 * `primaryKey`. The journal also supports replay (`EventJournal.entries`) and
 * change subscription (`EventJournal.changes`).
 */
export const make = Effect.fn(function* (
  options: {
    readonly primaryKey?: (event: Event) => string;
  } = {},
): Effect.fn.Return<Persist, never, EventJournal.EventJournal> {
  const journal = yield* EventJournal.EventJournal;
  const key = options.primaryKey ?? primaryKey;

  return {
    send: (stream: EventStream) =>
      stream.pipe(
        Stream.runForEach((event) =>
          encode(event).pipe(
            Effect.map((encoded) => encoder.encode(JSON.stringify(encoded))),
            Effect.flatMap((payload) =>
              journal.write({
                event: event._tag,
                primaryKey: key(event),
                payload,
                effect: () => Effect.void,
              }),
            ),
            Effect.mapError(EventError.invalid),
          ),
        ),
      ),
  } satisfies Persist;
});

/**
 * Provides the event persistence sink backed by the SQL event journal, written
 * to a local SQLite file.
 *
 * Uses `@effect/sql-sqlite-node` (Node's built-in `node:sqlite`, WAL enabled)
 * so the journal is persisted to `filename` and survives process restarts.
 * Note: `@effect/sql-sqlite-wasm` is in-memory-only in Node and cannot write a
 * real file — do not use it here.
 */
export const layer = (options: {
  readonly filename: string;
  readonly primaryKey?: (event: Event) => string;
}) =>
  Layer.effect(Service)(make(options)).pipe(
    Layer.provide(SqlEventJournal.layer()),
    Layer.provide(SqliteClient.layer({ filename: options.filename })),
  );
