import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, layer as testLayer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Stream } from "effect";

import * as Event from "#/event/schema.ts";
import * as Persist from "./index.ts";

const layer = Persist.layer.pipe(Layer.provideMerge(NodeFileSystem.layer));

const evalID: Event.EvalID = {
  benchID: "bench",
  harnessID: "harness",
};

const events = [
  Event.EvalEndEvent.make({ id: evalID }),
  Event.SessionRetryEvent.make({
    id: {
      ...evalID,
      taskID: "task",
      trailIdx: 0,
      sessionIdx: 1,
    },
    reason: "retry",
  }),
] satisfies ReadonlyArray<Event.Event>;

describe("event persistence", () => {
  testLayer(layer)((it) => {
    it.effect("saves and loads an event stream as JSONL", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const persist = yield* Persist.Service;
        const path = yield* fs.makeTempFileScoped({ suffix: ".jsonl" });

        yield* persist.save(path, Stream.fromIterable(events));

        const loaded = yield* persist.load(path).pipe(Stream.runCollect);
        assert.deepStrictEqual(Array.from(loaded), events);
      }),
    );

    it.effect("fails when a JSONL record is invalid", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const persist = yield* Persist.Service;
        const path = yield* fs.makeTempFileScoped({ suffix: ".jsonl" });
        yield* fs.writeFileString(path, "not json\n");

        const error = yield* persist.load(path).pipe(Stream.runDrain, Effect.flip);
        assert.strictEqual(error._tag, "NdjsonError");
      }),
    );
  });
});
