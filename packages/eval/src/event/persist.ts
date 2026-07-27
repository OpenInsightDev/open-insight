import { Crypto, Effect, Option, Ref, Schema, Semaphore, Stream, type Scope } from "effect";
import { Persistence } from "effect/unstable/persistence";
import { Error as EventError } from "./error.ts";
import type { EventStream } from "./queue.ts";
import { Event } from "./schema.ts";
import type { EventTransport } from "./service.ts";

const metadataKey = "metadata";
const replayBatchSize = 128;

const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

class JournalMetadata extends Schema.Class<JournalMetadata>("EventJournalMetadata")({
  version: Schema.Literal(1),
  length: Sequence,
}) {}

class JournalEntry extends Schema.Class<JournalEntry>("EventJournalEntry")({
  version: Schema.Literal(1),
  event: Event,
}) {}

const Operation = Schema.Literals(["load", "append", "replay", "clear"]);
type Operation = typeof Operation.Type;

/** A backing-store or journal-integrity failure. */
export class EventJournalError extends Schema.TaggedErrorClass<EventJournalError>()(
  "EventJournalError",
  {
    storeId: Schema.String,
    operation: Operation,
    sequence: Schema.NullOr(Sequence),
    cause: Schema.Defect(),
  },
) {}

export interface EventJournal {
  /** Appends one event and returns its zero-based sequence number. */
  readonly append: (event: Event) => Effect.Effect<number, EventJournalError>;
  /** Consumes a stream sequentially, committing each event before pulling the next one. */
  readonly write: <E, R>(
    stream: Stream.Stream<Event, E, R>,
  ) => Effect.Effect<void, E | EventJournalError, R>;
  /** Replays the committed snapshot visible when the stream starts running. */
  readonly replay: Stream.Stream<Event, EventJournalError, Crypto.Crypto>;
  readonly size: Effect.Effect<number>;
  readonly clear: Effect.Effect<void, EventJournalError>;
  /** Adapter for the evaluator's existing event transport service. */
  readonly transport: EventTransport;
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
export const make = Effect.fn("EventJournal.make")(function* (
  options: Readonly<{ storeId: string }>,
): Effect.fn.Return<EventJournal, EventJournalError, Persistence.BackingPersistence | Scope.Scope> {
  const { storeId } = options;
  const backing = yield* Persistence.BackingPersistence;
  const store = yield* backing.make(storeId);

  const journalError =
    (operation: Operation, sequence: number | null = null) =>
    (cause: unknown) =>
      new EventJournalError({ storeId, operation, sequence, cause });

  const loadMetadata = store.get(metadataKey).pipe(
    Effect.mapError(journalError("load")),
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.succeed(new JournalMetadata({ version: 1, length: 0 }))
        : Schema.decodeUnknownEffect(JournalMetadata)(value).pipe(
            Effect.mapError(journalError("load")),
          ),
    ),
  );

  const initialMetadata = yield* loadMetadata;
  const lengthRef = yield* Ref.make(initialMetadata.length);
  const appendLock = yield* Semaphore.make(1);

  const append = Effect.fn("EventJournal.append")(function* (event: Event) {
    return yield* Semaphore.withPermit(
      appendLock,
      Effect.uninterruptible(
        Effect.gen(function* () {
          const sequence = yield* Ref.get(lengthRef);
          const encodedEntry = yield* Schema.encodeEffect(JournalEntry)(
            new JournalEntry({ version: 1, event }),
          ).pipe(Effect.mapError(journalError("append", sequence)));

          yield* store
            .set(eventKey(sequence), encodedEntry, undefined)
            .pipe(Effect.mapError(journalError("append", sequence)));

          const nextLength = sequence + 1;
          const encodedMetadata = yield* Schema.encodeEffect(JournalMetadata)(
            new JournalMetadata({ version: 1, length: nextLength }),
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

  const readBatch = Effect.fn("EventJournal.readBatch")(function* (start: number, end: number) {
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
      const entry = yield* Schema.decodeUnknownEffect(JournalEntry)(value).pipe(
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

  const write: EventJournal["write"] = (stream) => Stream.runForEach(stream, append);

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
  } satisfies EventTransport;

  return {
    append,
    write,
    replay,
    size: Ref.get(lengthRef),
    clear,
    transport,
  };
});
