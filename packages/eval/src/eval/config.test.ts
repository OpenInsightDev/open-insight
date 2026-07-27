import { assert, it } from "@effect/vitest";
import { DefaultConfig, make } from "./config.ts";

it("merges partial overrides with the default evaluation config", () => {
  assert.deepStrictEqual(make({ trailCount: 5 }), {
    ...DefaultConfig,
    trailCount: 5,
  });
});
