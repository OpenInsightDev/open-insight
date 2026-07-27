import { NodeServices } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Context, Duration, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { Persistence } from "effect/unstable/persistence";
import { TestClock } from "effect/testing";
import { EvalScheduleEvent } from "./schema.ts";
import { make as makeJournal } from "./persist.ts";
import { jsonlFileName, layerBackingJsonl, makeBackingJsonl } from "./jsonl.ts";

class TestDirectory extends Context.Service<TestDirectory, { readonly path: string }>()(
  "EventJsonl/TestDirectory",
) {}

const testLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    return Layer.merge(
      layerBackingJsonl({ directory }),
      Layer.succeed(TestDirectory, { path: directory }),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

const event = (op: "start" | "stop") =>
  new EvalScheduleEvent({ bench: "bench", harness: "harness", op });

it.layer(testLayer)("JSONL BackingPersistence", (it) => {
  it.effect("persists an event journal as JSONL and replays it", () =>
    Effect.gen(function* () {
      const journal = yield* makeJournal({ storeId: "run/one" });
      yield* journal.write(Stream.make(event("start"), event("stop")));

      const { path: directory } = yield* TestDirectory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const content = yield* fs.readFileString(path.join(directory, jsonlFileName("run/one")));

      assert.strictEqual(content.trim().split("\n").length, 4);
      assert.include(content, '"key":"event:0"');
      assert.include(content, '"key":"metadata"');
      assert.strictEqual((yield* Stream.runCollect(journal.replay)).length, 2);
    }),
  );

  it.effect("reloads values from a new backing service instance", () =>
    Effect.gen(function* () {
      const { path: directory } = yield* TestDirectory;
      const first = yield* makeBackingJsonl({ directory });
      const firstStore = yield* first.make("reload");
      yield* firstStore.set("key", { value: 1 }, undefined);

      const second = yield* makeBackingJsonl({ directory });
      const secondStore = yield* second.make("reload");
      assert.deepStrictEqual(yield* secondStore.get("key"), { value: 1 });
    }),
  );

  it.effect("recovers an incomplete trailing JSONL record", () =>
    Effect.gen(function* () {
      const { path: directory } = yield* TestDirectory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const first = yield* makeBackingJsonl({ directory });
      const firstStore = yield* first.make("partial");
      yield* firstStore.set("first", { value: 1 }, undefined);

      const filePath = path.join(directory, jsonlFileName("partial"));
      yield* fs.writeFileString(filePath, '{"_tag":"Set"', { flag: "a" });

      const second = yield* makeBackingJsonl({ directory });
      const secondStore = yield* second.make("partial");
      assert.deepStrictEqual(yield* secondStore.get("first"), { value: 1 });
      yield* secondStore.set("second", { value: 2 }, undefined);

      const third = yield* makeBackingJsonl({ directory });
      const thirdStore = yield* third.make("partial");
      assert.deepStrictEqual(yield* thirdStore.getMany(["first", "second"]), [
        { value: 1 },
        { value: 2 },
      ]);
    }),
  );

  it.effect("truncates the JSONL file when the store is cleared", () =>
    Effect.gen(function* () {
      const backing = yield* Persistence.BackingPersistence;
      const store = yield* backing.make("clear");
      yield* store.setMany([
        ["first", { value: 1 }, undefined],
        ["second", { value: 2 }, undefined],
      ]);
      yield* store.clear;

      const { path: directory } = yield* TestDirectory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const content = yield* fs.readFileString(path.join(directory, jsonlFileName("clear")));
      assert.strictEqual(content.trim().split("\n").length, 1);
      assert.include(content, '"_tag":"Clear"');
      assert.strictEqual(yield* store.get("first"), undefined);
    }),
  );

  it.effect("expires values using their persisted absolute TTL", () =>
    Effect.gen(function* () {
      const backing = yield* Persistence.BackingPersistence;
      const store = yield* backing.make("ttl");
      yield* store.set("key", { value: 1 }, Duration.seconds(10));

      yield* TestClock.adjust(Duration.seconds(10));
      assert.strictEqual(yield* store.get("key"), undefined);
    }),
  );

  it.effect("rejects a malformed complete JSONL record", () =>
    Effect.gen(function* () {
      const { path: directory } = yield* TestDirectory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(
        path.join(directory, jsonlFileName("malformed")),
        '{"unexpected":true}\n',
      );

      const backing = yield* makeBackingJsonl({ directory });
      const store = yield* backing.make("malformed");
      const error = yield* store.get("key").pipe(Effect.flip);
      assert.instanceOf(error, Persistence.PersistenceError);
    }),
  );
});
