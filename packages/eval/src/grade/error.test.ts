import { assert, it } from "@effect/vitest";
import { Error, Retry, retry } from "./error.ts";

it("creates an independent grader retry signal", () => {
  const signal = retry("Complete the missing work before grading again.");

  assert.instanceOf(signal, globalThis.Error);
  assert.instanceOf(signal, Retry);
  assert.notInstanceOf(signal, Error);
  assert.strictEqual(signal.prompt, "Complete the missing work before grading again.");
});
