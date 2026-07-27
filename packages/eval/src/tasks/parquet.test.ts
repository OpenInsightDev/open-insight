import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { Error } from "./error.ts";
import { withParquetDir } from "./parquet.ts";

const parquetFixture = Buffer.from(
  "UEFSMRUAFSAVICwVBBUAFQYVBgAAAgAAAAQBAQAAADEBAAAAMhUAFTIVMiwVBBUAFQYVBgAAAgAAAAQBBQAAAGZpcnN0BgAAAHNlY29uZBUCGTw1ABgNZHVja2RiX3NjaGVtYRUEABUMJQIYAmlkJQAAFQwlAhgEbmFtZSUAABYEGRwZLCYAHBUMGRUAGRgCaWQVABYEFkIWQiYIPBgBMhgBMRYAKAEyGAExEREAAAAmABwVDBkVABkYBG5hbWUVABYEFlQWVCZKPBgGc2Vjb25kGAVmaXJzdBYAKAZzZWNvbmQYBWZpcnN0EREAAAAWlgEWBCYIFpYBACgoRHVja0RCIHZlcnNpb24gdjEuNS41IChidWlsZCBkOGNkYWEzM2ZkKRksHAAAHAAAAN4AAABQQVIx",
  "base64",
);

const Row = Schema.Struct({
  id: Schema.NumberFromString,
  name: Schema.String,
});

describe("withParquetDir", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("loads matching parquet files into a validated stream", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFile(path.join(directory, "train-000.parquet"), parquetFixture);
        yield* fs.writeFile(path.join(directory, "ignored.parquet"), parquetFixture);

        const load = withParquetDir({
          dirPath: directory,
          prefix: "train-",
          schema: Row,
        });

        const tasks = yield* load(({ items }) =>
          items.pipe(
            Stream.runCollect,
            Effect.tap((rows) =>
              Effect.sync(() =>
                assert.deepStrictEqual(rows, [
                  { id: 1, name: "first" },
                  { id: 2, name: "second" },
                ]),
              ),
            ),
            Effect.as([]),
          ),
        );

        assert.deepStrictEqual(tasks, []);
      }),
    );

    it.effect("reports rows rejected by the schema as invalid tasks", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFile(path.join(directory, "train-000.parquet"), parquetFixture);

        const load = withParquetDir({
          dirPath: directory,
          prefix: "train-",
          schema: Schema.Struct({ id: Schema.Number, name: Schema.String }),
        });
        const error = yield* load(({ items }) => items.pipe(Stream.runDrain, Effect.as([]))).pipe(
          Effect.flip,
        );

        assert.instanceOf(error, Error);
        assert.strictEqual(error.reason._tag, "InvalidTaskError");
      }),
    );

    it.effect("reports parquet read failures as source errors", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(path.join(directory, "train-invalid.parquet"), "invalid");

        const load = withParquetDir({
          dirPath: directory,
          prefix: "train-",
          schema: Row,
        });
        const error = yield* load(({ items }) => items.pipe(Stream.runDrain, Effect.as([]))).pipe(
          Effect.flip,
        );

        assert.instanceOf(error, Error);
        assert.strictEqual(error.reason._tag, "SourceError");
      }),
    );
  });
});
