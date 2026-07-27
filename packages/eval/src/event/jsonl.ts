import { Duration, Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect";
import { Persistence } from "effect/unstable/persistence";

const JsonObject = Schema.Record(Schema.String, Schema.Json);

class SetRecord extends Schema.TaggedClass<SetRecord>()("Set", {
  key: Schema.String,
  value: JsonObject,
  expiresAt: Schema.NullOr(Schema.Number),
}) {}

class RemoveRecord extends Schema.TaggedClass<RemoveRecord>()("Remove", {
  key: Schema.String,
}) {}

class ClearRecord extends Schema.TaggedClass<ClearRecord>()("Clear", {}) {}

const JsonlRecord = Schema.Union([SetRecord, RemoveRecord, ClearRecord]);
const JsonlRecordFromString = Schema.fromJsonString(JsonlRecord);

type StoredValue = Readonly<{
  value: object;
  expiresAt: number | null;
}>;

export interface JsonlBackingOptions {
  /** Directory containing one JSONL file per `BackingPersistence` store id. */
  readonly directory: string;
}

export const jsonlFileName = (storeId: string) => `${encodeURIComponent(storeId)}.jsonl`;

/** Creates a file-backed `BackingPersistence` service without wrapping it in a Layer. */
export const makeBackingJsonl = Effect.fn("EventJsonl.makeBacking")(function* (
  options: JsonlBackingOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stores = new Map<string, Persistence.BackingPersistenceStore>();

  const makeStore = (storeId: string): Persistence.BackingPersistenceStore => {
    const filePath = path.join(options.directory, jsonlFileName(storeId));
    const lock = Semaphore.makeUnsafe(1);
    const values = new Map<string, StoredValue>();
    let loaded = false;

    const persistenceError = (operation: string) => (cause: unknown) =>
      new Persistence.PersistenceError({
        message: `JSONL backing store ${operation} failed for ${filePath}`,
        cause,
      });

    const encodeRecord = (record: typeof JsonlRecord.Type) =>
      Schema.encodeEffect(JsonlRecordFromString)(record).pipe(
        Effect.mapError(persistenceError("encode")),
      );

    const applyRecord = (record: typeof JsonlRecord.Type) => {
      switch (record._tag) {
        case "Set":
          values.set(record.key, { value: record.value, expiresAt: record.expiresAt });
          break;
        case "Remove":
          values.delete(record.key);
          break;
        case "Clear":
          values.clear();
          break;
      }
    };

    const invalidate = Effect.sync(() => {
      loaded = false;
      values.clear();
    });

    const write = (data: string, flag: "a" | "w", operation: string) =>
      fs.writeFileString(filePath, data, { flag }).pipe(
        Effect.mapError(persistenceError(operation)),
        Effect.tapError(() => invalidate),
      );

    const ensureLoaded = Effect.fn("EventJsonl.load")(function* () {
      if (loaded) {
        return;
      }
      values.clear();

      yield* fs
        .makeDirectory(options.directory, { recursive: true })
        .pipe(Effect.mapError(persistenceError("create directory")));

      const exists = yield* fs.exists(filePath).pipe(Effect.mapError(persistenceError("stat")));
      if (!exists) {
        loaded = true;
        return;
      }

      const content = yield* fs
        .readFileString(filePath)
        .pipe(Effect.mapError(persistenceError("read")));
      const lastNewline = content.lastIndexOf("\n");
      const completeContent = content.endsWith("\n")
        ? content
        : lastNewline === -1
          ? ""
          : content.slice(0, lastNewline + 1);

      // A process may exit during append. Only a trailing incomplete line is recoverable.
      if (completeContent.length !== content.length) {
        yield* write(completeContent, "w", "truncate incomplete record");
      }

      const lines = completeContent.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.length === 0) {
          continue;
        }
        const record = yield* Schema.decodeUnknownEffect(JsonlRecordFromString)(line).pipe(
          Effect.mapError((cause) => persistenceError(`decode line ${index + 1}`)(cause)),
        );
        applyRecord(record);
      }

      loaded = true;
    });

    const unsafeGet = (key: string, now: number): object | undefined => {
      const stored = values.get(key);
      if (stored === undefined) {
        return undefined;
      }
      if (stored.expiresAt !== null && stored.expiresAt <= now) {
        values.delete(key);
        return undefined;
      }
      return stored.value;
    };

    const setMany: Persistence.BackingPersistenceStore["setMany"] = (entries) =>
      Effect.clockWith((clock) =>
        Semaphore.withPermit(
          lock,
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* ensureLoaded();
              const prepared: Array<Readonly<{ record: SetRecord; encoded: string }>> = [];
              for (const [key, value, ttl] of entries) {
                const jsonValue = yield* Schema.decodeUnknownEffect(JsonObject)(value).pipe(
                  Effect.mapError(persistenceError(`validate value for key ${key}`)),
                );
                const expiresAt =
                  ttl !== undefined && Duration.isFinite(ttl)
                    ? clock.currentTimeMillisUnsafe() + Duration.toMillis(ttl)
                    : null;
                const record = new SetRecord({ key, value: jsonValue, expiresAt });
                prepared.push({ record, encoded: yield* encodeRecord(record) });
              }

              yield* write(prepared.map(({ encoded }) => `${encoded}\n`).join(""), "a", "append");
              for (const { record } of prepared) {
                applyRecord(record);
              }
            }),
          ),
        ),
      );

    return {
      get: (key) =>
        Effect.clockWith((clock) =>
          Semaphore.withPermit(
            lock,
            ensureLoaded().pipe(
              Effect.andThen(Effect.sync(() => unsafeGet(key, clock.currentTimeMillisUnsafe()))),
            ),
          ),
        ),
      getMany: (keys) =>
        Effect.clockWith((clock) =>
          Semaphore.withPermit(
            lock,
            ensureLoaded().pipe(
              Effect.andThen(
                Effect.sync(() => {
                  const now = clock.currentTimeMillisUnsafe();
                  const results: [object | undefined, ...Array<object | undefined>] = [
                    unsafeGet(keys[0], now),
                  ];
                  for (let index = 1; index < keys.length; index++) {
                    results.push(unsafeGet(keys[index], now));
                  }
                  return results;
                }),
              ),
            ),
          ),
        ),
      set: (key, value, ttl) => setMany([[key, value, ttl]]),
      setMany,
      remove: (key) =>
        Semaphore.withPermit(
          lock,
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* ensureLoaded();
              const record = new RemoveRecord({ key });
              const encoded = yield* encodeRecord(record);
              yield* write(`${encoded}\n`, "a", "remove");
              applyRecord(record);
            }),
          ),
        ),
      clear: Semaphore.withPermit(
        lock,
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* ensureLoaded();
            const record = new ClearRecord({});
            const encoded = yield* encodeRecord(record);
            const temporaryPath = `${filePath}.clear.tmp`;
            yield* fs.writeFileString(temporaryPath, `${encoded}\n`, { flag: "w" }).pipe(
              Effect.mapError(persistenceError("write clear record")),
              Effect.tapError(() => invalidate),
            );
            yield* fs.rename(temporaryPath, filePath).pipe(
              Effect.mapError(persistenceError("commit clear")),
              Effect.tapError(() => invalidate),
            );
            applyRecord(record);
          }),
        ),
      ),
    };
  };

  return Persistence.BackingPersistence.of({
    make: (storeId) =>
      Effect.sync(() => {
        const existing = stores.get(storeId);
        if (existing !== undefined) {
          return existing;
        }
        const store = makeStore(storeId);
        stores.set(storeId, store);
        return store;
      }),
  });
});

/**
 * Provides `BackingPersistence` using append-only JSONL files.
 *
 * Store instances created by this Layer are synchronized in-process. A store id must not have
 * multiple writer processes because the portable FileSystem service does not expose file locks.
 */
export const layerBackingJsonl = (
  options: JsonlBackingOptions,
): Layer.Layer<Persistence.BackingPersistence, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(Persistence.BackingPersistence)(makeBackingJsonl(options));
