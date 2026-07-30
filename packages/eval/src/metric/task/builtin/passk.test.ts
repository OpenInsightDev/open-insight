import { Prompt } from "@open-insight/core/internal";
import { describe, expect, it } from "vite-plus/test";
import { DateTime, Effect } from "effect";
import { Response } from "effect/unstable/ai";
import { passAtK, passPowK } from "./passk.ts";
import type { TrailResult } from "#/eval/result.ts";

const now = DateTime.fromDateUnsafe(new Date(0));
const usage = Response.Usage.make({
  inputTokens: { uncached: 0, total: 0 },
  outputTokens: { total: 0 },
});
const trail = (pass: boolean): TrailResult<{ pass: boolean }> => ({
  startedAt: now,
  finishedAt: now,
  usage,
  grade: { pass },
  trajectory: Prompt.empty,
});

describe("passAtK", () => {
  it("returns zero when every attempt fails", async () => {
    const metric = await Effect.runPromise(passAtK(2));
    await expect(
      metric([trail(false), trail(false), trail(false)], trail(false), null),
    ).resolves.toEqual({
      "pass@k": 0,
    });
  });

  it("returns one when every attempt passes", async () => {
    const metric = await Effect.runPromise(passAtK(2));
    await expect(
      metric([trail(true), trail(true), trail(true)], trail(true), null),
    ).resolves.toEqual({
      "pass@k": 1,
    });
  });

  it("uses the unbiased pass@k estimator", async () => {
    const metric = await Effect.runPromise(passAtK(2));
    await expect(
      metric(
        [trail(true), trail(false), trail(true), trail(false), trail(false)],
        trail(false),
        null,
      ),
    ).resolves.toEqual({ "pass@k": 0.7 });
  });

  it("accepts grade types extending pass", async () => {
    const metric = await Effect.runPromise(passAtK<{ pass: boolean; score: number }>(1));
    const trailGrade = (score: number): TrailResult<{ pass: boolean; score: number }> => ({
      startedAt: now,
      finishedAt: now,
      usage,
      grade: { pass: score > 0, score },
      trajectory: Prompt.empty,
    });

    await expect(metric([trailGrade(0), trailGrade(1)], trailGrade(1), null)).resolves.toEqual({
      "pass@k": 0.5,
    });
  });
});

describe("passPowK", () => {
  it("returns zero with fewer than k passing attempts", async () => {
    const metric = await Effect.runPromise(passPowK(2));
    await expect(
      metric([trail(true), trail(false), trail(false)], trail(false), null),
    ).resolves.toEqual({
      "pass^k": 0,
    });
  });

  it("returns one when every attempt passes", async () => {
    const metric = await Effect.runPromise(passPowK(2));
    await expect(
      metric([trail(true), trail(true), trail(true)], trail(true), null),
    ).resolves.toEqual({
      "pass^k": 1,
    });
  });

  it("uses the unbiased pass^k estimator", async () => {
    const metric = await Effect.runPromise(passPowK(2));
    await expect(
      metric(
        [trail(true), trail(false), trail(true), trail(false), trail(true)],
        trail(true),
        null,
      ),
    ).resolves.toEqual({ "pass^k": 0.3 });
  });
});
