import { Crypto, Effect, Option, Ref, Schema, Semaphore, Stream, type Scope } from "effect";
import { Persistence } from "effect/unstable/persistence";
import { EventError } from "../error.ts";
import type { EventStream } from "../queue.ts";
import type { Event } from "../schema.ts";
import type { Transport } from "../transport/schema.ts";
import { Entry, Error, Metadata, type Operation, type Options } from "./schema.ts";

const metadataKey = "metadata";
const replayBatchSize = 128;
const Cause = Schema.Error();

export interface Journal {
  /** Appends one event and returns its zero-based sequence number. */
  readonly append: (event: Event) => Effect.Effect<number, Error>;
  /** Consumes a stream sequentially, committing each event before pulling the next one. */
  readonly write: <E, R>(stream: Stream.Stream<Event, E, R>) => Effect.Effect<void, E | Error, R>;
  /** Replays the committed snapshot visible when the stream starts running. */
  readonly replay: Stream.Stream<Event, Error, Crypto.Crypto>;
  readonly size: Effect.Effect<number>;
  readonly clear: Effect.Effect<void, Error>;
  /** Adapter for the evaluator's event transport service. */
  readonly transport: Transport;
}

const eventKey = (sequence: number) => `event:${sequence}`;

/**
 * Creates a journal backed by one `BackingPersistence` store.
 *
 * Appends use an event-first, metadata-second commit protocol. A process exit between the
 * two writes can leave an uncommitted event key, but replay only observes the length recorded
 * in metadata. Each journal instance serializes its own appends; a store id must still have a
 * single writer across journal instances and processes because `BackingPersistence` has no CAS.
 */
export const make = Effect.fn("Persist.make")(function* (
  options: Options,
): Effect.fn.Return<Journal, Error, Persistence.BackingPersistence | Scope.Scope> {
  const { storeId } = options;
  const backing = yield* Persistence.BackingPersistence;
  const store = yield* backing.make(storeId);

  const journalError =
    (operation: Operation, sequence: number | null = null) =>
    (cause: unknown) =>
      new Error({ storeId, operation, sequence, cause: Schema.decodeUnknownSync(Cause)(cause) });

  const loadMetadata = store.get(metadataKey).pipe(
    Effect.mapError(journalError("load")),
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.succeed(new Metadata({ version: 1, length: 0 }))
        : Schema.decodeUnknownEffect(Metadata)(value).pipe(Effect.mapError(journalError("load"))),
    ),
  );

  const initialMetadata = yield* loadMetadata;
  const lengthRef = yield* Ref.make(initialMetadata.length);
  const appendLock = yield* Semaphore.make(1);

  const append = Effect.fn("Persist.append")(function* (event: Event) {
    return yield* Semaphore.withPermit(
      appendLock,
      Effect.uninterruptible(
        Effect.gen(function* () {
          const sequence = yield* Ref.get(lengthRef);
          const encodedEntry = yield* Schema.encodeEffect(Entry)(
            new Entry({ version: 1, event }),
          ).pipe(Effect.mapError(journalError("append", sequence)));

          yield* store
            .set(eventKey(sequence), encodedEntry, undefined)
            .pipe(Effect.mapError(journalError("append", sequence)));

          const nextLength = sequence + 1;
          const encodedMetadata = yield* Schema.encodeEffect(Metadata)(
            new Metadata({ version: 1, length: nextLength }),
          ).pipe(Effect.mapError(journalError("append", sequence)));

          yield* store
            .set(metadataKey, encodedMetadata, undefined)
            .pipe(Effect.mapError(journalError("append", sequence)));
          yield* Ref.set(lengthRef, nextLength);

          return sequence;
        }),
      ),
    );
  });

  const readBatch = Effect.fn("Persist.readBatch")(function* (start: number, end: number) {
    const keys: [string, ...Array<string>] = [eventKey(start)];
    for (let sequence = start + 1; sequence < end; sequence++) {
      keys.push(eventKey(sequence));
    }

    const values = yield* store.getMany(keys).pipe(Effect.mapError(journalError("replay")));
    if (values.length !== keys.length) {
      return yield* Effect.fail(
        journalError("replay")(
          new globalThis.Error(
            `Expected ${keys.length} events from backing store, received ${values.length}`,
          ),
        ),
      );
    }
    const events: Array<Event> = [];
    for (let offset = 0; offset < values.length; offset++) {
      const sequence = start + offset;
      const value = values[offset];
      if (value === undefined) {
        return yield* Effect.fail(
          journalError(
            "replay",
            sequence,
          )(new globalThis.Error(`Committed event ${sequence} is missing`)),
        );
      }
      const entry = yield* Schema.decodeUnknownEffect(Entry)(value).pipe(
        Effect.mapError(journalError("replay", sequence)),
      );
      events.push(entry.event);
    }
    return events;
  });

  const replay = Stream.unwrap(
    loadMetadata.pipe(
      Effect.map((metadata) => {
        if (metadata.length === 0) {
          return Stream.empty;
        }
        return Stream.paginate(0, (start) => {
          const end = Math.min(start + replayBatchSize, metadata.length);
          return readBatch(start, end).pipe(
            Effect.map((events) => {
              const next = end < metadata.length ? Option.some(end) : Option.none<number>();
              const page: readonly [ReadonlyArray<Event>, Option.Option<number>] = [events, next];
              return page;
            }),
          );
        });
      }),
    ),
  );

  const write: Journal["write"] = (stream) => Stream.runForEach(stream, append);

  const clear = Semaphore.withPermit(
    appendLock,
    Effect.uninterruptible(
      store.clear.pipe(
        Effect.mapError(journalError("clear")),
        Effect.andThen(Ref.set(lengthRef, 0)),
      ),
    ),
  );

  const transport = {
    send: (stream: EventStream) => write(stream).pipe(Effect.mapError(EventError.send)),
  } satisfies Transport;

  return {
    append,
    write,
    replay,
    size: Ref.get(lengthRef),
    clear,
    transport,
  };
});
