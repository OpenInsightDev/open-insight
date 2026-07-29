import { Prompt } from "@open-insight/core/internal";
import { DateTime, Schema } from "effect";
import { Response } from "effect/unstable/ai";
import { assert, it } from "@effect/vitest";
import { TrailResult } from "./result.ts";

it("generates timestamps when constructing and decoding a trail result", () => {
  const usage = Response.Usage.make({ inputTokens: {}, outputTokens: {} });
  const result = Schema.decodeSync(TrailResult)({ grade: {}, trajectory: Prompt.empty, usage });

  assert.isTrue(DateTime.isUtc(result.startedAt));
  assert.isTrue(DateTime.isUtc(result.finishedAt));

  const decoded = Schema.decodeUnknownSync(TrailResult)({
    grade: {},
    trajectory: Prompt.empty,
    usage,
  });

  assert.isTrue(DateTime.isUtc(decoded.startedAt));
  assert.isTrue(DateTime.isUtc(decoded.finishedAt));
});
