import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Sink, Stream } from "effect";
import * as StreamReader from "#/StreamReader.ts";

const inMemoryFileSystem = <A>(layer: Layer.Layer<A, never, FileSystem.FileSystem>) => {
  const files = new Map<string, Array<Uint8Array>>();

  return {
    files,
    layer: layer.pipe(
      Layer.provide(
        FileSystem.layerNoop({
          sink: (path: string) =>
            Sink.forEach((chunk: Uint8Array) =>
              Effect.sync(() => {
                const chunks = files.get(path) ?? [];
                chunks.push(chunk.slice());
                files.set(path, chunks);
              }),
            ),
          stream: (path: string) => Stream.fromIterable(files.get(path) ?? []),
        }),
      ),
    ),
  };
};

const encode = (text: string) => new TextEncoder().encode(text);

it.effect("reads newline-delimited JSON records with schemas supplied per operation", () => {
  const memory = inMemoryFileSystem(StreamReader.StreamReader.layer);
  const User = Schema.Struct({ id: Schema.Number, name: Schema.String });

  memory.files.set("users.ndjson", [encode('{"id":1,"name":"Ada"}\n{"id":2,"name":"Grace"}\n')]);
  memory.files.set("labels.ndjson", [encode('"alpha"\n"beta"\n')]);

  return Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;

    assert.deepStrictEqual(yield* Stream.runCollect(reader.read(User)("users.ndjson")), [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    assert.deepStrictEqual(yield* Stream.runCollect(reader.read(Schema.String)("labels.ndjson")), [
      "alpha",
      "beta",
    ]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("ignores empty lines while reading", () => {
  const memory = inMemoryFileSystem(StreamReader.StreamReader.layer);
  memory.files.set("values.ndjson", [encode("1\n\n2\n")]);

  return Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;
    const values = yield* Stream.runCollect(reader.read(Schema.Number)("values.ndjson"));

    assert.deepStrictEqual(values, [1, 2]);
  }).pipe(Effect.provide(memory.layer));
});

it.effect("classifies file-system read failures as ReadFailed", () =>
  Effect.gen(function* () {
    const reader = yield* StreamReader.StreamReader;

    const error = yield* Stream.runCollect(reader.read(Schema.String)("missing.ndjson")).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, StreamReader.ReadFailed);
    assert.strictEqual(error._tag, "ReadFailed");
  }).pipe(
    Effect.provide(StreamReader.StreamReader.layer.pipe(Layer.provide(FileSystem.layerNoop({})))),
  ),
);
