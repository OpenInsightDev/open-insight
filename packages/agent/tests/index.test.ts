import { assert, it } from "@effect/vitest";
import * as Agent from "#/index.ts";

it("loads the package entrypoint", () => {
  assert.ok(Agent);
});
