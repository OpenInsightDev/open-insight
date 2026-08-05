import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Grade from "./index.ts";

const GradeResult = Schema.Struct({
  passed: Schema.Boolean,
  score: Schema.NumberFromString,
  summary: Schema.String,
});

describe("grade verification", () => {
  it.effect("ignores encoded fields omitted from expect", () =>
    Effect.gen(function* () {
      const matches = yield* Grade.matches(
        GradeResult,
        { passed: true, score: "1", summary: "1 passed in 0.25s" },
        { passed: true, score: "1" },
      );

      assert.isTrue(matches);
    }),
  );

  it.effect("compares expected fields after decoding", () =>
    Effect.gen(function* () {
      const matches = yield* Grade.matches(
        GradeResult,
        { passed: true, score: "1", summary: "dynamic" },
        { score: "2" },
      );

      assert.isFalse(matches);
    }),
  );

  it("infers expect from the grader encoded type", () => {
    const grader = Grade.make(GradeResult)(
      async () => ({ passed: true, score: "1", summary: "dynamic" }),
      {
        verif: async () => null,
        expect: { passed: true, score: "1" },
      },
    );

    assert.deepStrictEqual(grader.verif?.expect, { passed: true, score: "1" });
  });
});
