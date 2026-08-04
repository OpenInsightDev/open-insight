import { parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";
import { Effect, FileSystem, Layer, Path, Schema, Semaphore, Stream } from "effect";
import { EventError } from "#/event/error.ts";
import type { EventStream } from "#/event/queue.ts";
import { Event } from "#/event/schema.ts";
import { Service as TransportService } from "#/event/transport/service.ts";
import type { Transport } from "#/event/transport/schema.ts";
import { Error as PersistError, Sequence } from "#/event/persist/schema.ts";

const formatVersion = "1";
const Cause = Schema.Error();

class Row extends Schema.Class<Row>("PersistParquetRow")({
  sequence: Sequence,
  event: Event,
}) {}

const Rows = Schema.Array(Row);

export interface Options {
  /** Destination for the complete event stream. Existing files are replaced atomically. */
  readonly filePath: string;
}

const encodeRows = Effect.fn("Persist.Parquet.encodeRows")(function* (
  events: ReadonlyArray<Event>,
) {
  const rows: Array<typeof Row.Encoded> = [];
  for (let sequence = 0; sequence < events.length; sequence++) {
    const row = yield* Schema.encodeEffect(Row)(
      new Row({ sequence, event: events[sequence] }),
    ).pipe(Effect.mapError(EventError.invalid));
    rows.push(row);
  }
  return rows;
});

const readObjects = Effect.fn("Persist.Parquet.readObjects")(function* (
  filePath: string,
): Effect.fn.Return<ReadonlyArray<unknown>, PersistError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const bytes = yield* fs.readFile(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new PersistError({
          storeId: filePath,
          operation: "load",
          sequence: null,
          cause,
        }),
    ),
  );
  const file = Uint8Array.from(bytes).buffer;

  return yield* Effect.tryPromise({
    try: (): Promise<ReadonlyArray<unknown>> => parquetReadObjects({ file }),
    catch: (cause) =>
      new PersistError({
        storeId: filePath,
        operation: "load",
        sequence: null,
        cause: Schema.decodeUnknownSync(Cause)(cause),
      }),
  });
});

const writeWith = Effect.fn("Persist.Parquet.write")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  options: Options,
  stream: EventStream,
) {
  const events = yield* Stream.runCollect(stream);
  const rows = yield* encodeRows(events);
  const buffer = yield* Effect.try({
    try: () =>
      parquetWriteBuffer({
        columnData: [
          {
            name: "sequence",
            data: rows.map((row) => row.sequence),
            type: "INT32",
            nullable: false,
          },
          {
            name: "event",
            data: rows.map((row) => row.event),
            type: "JSON",
            nullable: false,
          },
        ],
        kvMetadata: [{ key: "open-insight.persist.version", value: formatVersion }],
      }),
    catch: EventError.send,
  });

  const directory = path.dirname(options.filePath);
  const temporaryPath = path.join(directory, `.${path.basename(options.filePath)}.tmp`);
  yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(EventError.send));
  yield* fs
    .writeFile(temporaryPath, new Uint8Array(buffer), { flag: "w" })
    .pipe(
      Effect.andThen(fs.rename(temporaryPath, options.filePath)),
      Effect.ensuring(fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
      Effect.mapError(EventError.send),
    );
});

/** Creates an event transport that commits one Parquet file after its input stream completes. */
export const make = Effect.fn("Persist.Parquet.make")(function* (
  options: Options,
): Effect.fn.Return<Transport, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);

  return {
    send: (stream) => Semaphore.withPermit(lock, writeWith(fs, path, options, stream)),
  } satisfies Transport;
});

/** Consumes a complete event stream and atomically replaces the destination Parquet file. */
export const write = Effect.fn("Persist.Parquet.write")(function* (
  options: Options,
  stream: EventStream,
) {
  const transport = yield* make(options);
  yield* transport.send(stream);
});

/** Replays and validates all events from a Parquet file in their recorded order. */
export const replay = (
  options: Options,
): Stream.Stream<Event, PersistError, FileSystem.FileSystem> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const unknownRows = yield* readObjects(options.filePath);
      const rows = yield* Schema.decodeUnknownEffect(Rows)(unknownRows).pipe(
        Effect.mapError(
          (cause) =>
            new PersistError({
              storeId: options.filePath,
              operation: "replay",
              sequence: null,
              cause,
            }),
        ),
      );

      const events: Array<Event> = [];
      for (let sequence = 0; sequence < rows.length; sequence++) {
        const row = rows[sequence];
        if (row.sequence !== sequence) {
          return yield* new PersistError({
            storeId: options.filePath,
            operation: "replay",
            sequence,
            cause: new globalThis.Error(
              `Expected event sequence ${sequence}, received ${row.sequence}`,
            ),
          });
        }
        events.push(row.event);
      }
      return Stream.fromArray(events);
    }),
  );

/** Provides the evaluator's event transport with a terminal Parquet sink. */
export const layer = (
  options: Options,
): Layer.Layer<TransportService, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(TransportService)(make(options));
