import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { Prompt, Toolkit } from "effect/unstable/ai";
import { Metadata } from "./metadata.ts";
import { Persist } from "./persist.ts";
import { Part, type Any } from "./trajectory.ts";

const toolkit = Toolkit.merge();
const partSchema = Part(toolkit);

const prompt = Prompt.userMessage({
  content: [Prompt.textPart({ text: "Persist this trajectory" })],
});
const part = partSchema.make({
  _tag: "Prompt",
  messages: [prompt],

  uuid: "01890f47-3d90-7cc3-98c8-683a927d7851",
});
const trajectory = Object.assign(Stream.make(part), {
  toolkit,
  metadata: new Metadata({ name: "example", description: "persisted" }),
}) as Any;

const collect = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

const testLayer = Layer.merge(NodeServices.layer, Layer.provide(Persist.layer, NodeServices.layer));

layer(testLayer)((it) => {
  it.effect("saves and loads a trajectory using the default .traj suffix", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* fs.makeTempFile({ prefix: "trajectory-" });
        const persist = yield* Persist;
        yield* persist.save(path, trajectory);

        const saved = yield* fs.readFileString(`${path}.traj`);
        const lines = saved.split("\n").filter((line) => line.length > 0);
        assert.lengthOf(lines, 3);
        assert.deepEqual(JSON.parse(lines[0]!), { name: "example", description: "persisted" });

        const loaded = yield* persist.load(path);
        assert.deepEqual(loaded.metadata, trajectory.metadata);
        const parts = yield* collect(loaded);
        assert.lengthOf(parts, 1);
        assert.strictEqual(parts[0]?._tag, "Prompt");
        if (parts[0]?._tag === "Prompt") {
          const content = parts[0].messages[0]?.content;
          if (Array.isArray(content) && Schema.is(Prompt.TextPart)(content[0])) {
            assert.strictEqual(content[0].type, "text");
          }
        }
      }),
    ),
  );

  it.effect("loads a trajectory when the path already has the .traj suffix", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* fs.makeTempFile({ prefix: "trajectory-", suffix: ".traj" });
        yield* fs.writeFileString(
          path,
          `${JSON.stringify({ name: "loaded" })}\n${JSON.stringify({})}\n`,
        );

        const persist = yield* Persist;
        const loaded = yield* persist.load(path);
        assert.strictEqual(loaded.metadata.name, "loaded");
        assert.lengthOf(yield* collect(loaded), 0);
      }),
    ),
  );
});
