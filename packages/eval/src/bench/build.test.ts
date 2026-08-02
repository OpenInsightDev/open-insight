import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { make } from "./build.ts";

it.effect("loads tasks while constructing a benchmark", () =>
  Effect.gen(function* () {
    let loaded = false;

    const bench = yield* make({
      id: "example-bench",
      tasks: Effect.sync(() => {
        loaded = true;
        return [];
      }),
    });

    assert.isTrue(loaded);
    assert.strictEqual(bench.metadata.id, "example-bench");
    assert.lengthOf(bench.tasks, 0);
  }),
);
