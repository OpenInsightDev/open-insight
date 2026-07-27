import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import * as Task from "#/task/index.ts";
import type { Load } from "./index.ts";
import { Error } from "./error.ts";

const readParquetFile = Effect.fn(function* (
  filePath: string,
): Effect.fn.Return<ReadonlyArray<unknown>, Error> {
  return yield* Effect.tryPromise({
    try: async (): Promise<ReadonlyArray<unknown>> => {
      const file = await asyncBufferFromFile(filePath);
      return parquetReadObjects({ file });
    },
    catch: Error.source,
  });
});

export const withParquetDir = <S extends Schema.Constraint>({
  dirPath,
  prefix,
  schema,
}: {
  dirPath: string;
  prefix: string;
  schema: S;
}) =>
  Effect.fn(function* <T extends Task.Task, E, R>(
    exec: (options: {
      items: Stream.Stream<S["Type"], Error, S["DecodingServices"]>;
    }) => Load<T, E, R> | Promise<Load<T, E, R>>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const entries = yield* fs
      .readDirectory(dirPath, { recursive: true })
      .pipe(Effect.mapError(Error.source));
    const parquetFiles = entries
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".parquet"))
      .sort()
      .map((entry) => path.join(dirPath, entry));

    const items = Stream.fromArray(parquetFiles).pipe(
      Stream.mapEffect(readParquetFile),
      Stream.flatMap(Stream.fromArray),
      Stream.mapEffect((encoded) =>
        Schema.decodeUnknownEffect(schema)(encoded).pipe(Effect.mapError(Error.invalid)),
      ),
    );

    const loader = yield* Effect.tryPromise({
      try: () => Promise.resolve(exec({ items })),
      catch: Error.init,
    });
    return yield* loader;
  });
