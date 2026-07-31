import { Prompt } from "@open-insight/core/internal";
import { DateTime } from "effect";
import { Response } from "effect/unstable/ai";
import { describe, expect, it } from "vite-plus/test";
import type { TrailResult } from "#/eval/result.ts";
import { avgPassAtK, avgPassPowK } from "./passk.ts";

type PassTrail = TrailResult<Readonly<{ pass: boolean }>>;
const timestamp = DateTime.nowUnsafe();
const usage = Response.Usage.make({ inputTokens: {}, outputTokens: {} });
const trail = (pass: boolean): PassTrail => ({
  startedAt: timestamp,
  finishedAt: timestamp,
  usage,
  grade: { pass },
  trajectory: Prompt.empty,
});
const delta = (task: string, pass: boolean) => ({ ...trail(pass), task });

describe("avgPassAtK", () => {
  it("averages unbiased pass@k estimates across tasks", async () => {
    const results = {
      first: [trail(true), trail(false), trail(true), trail(false), trail(false)],
      second: [trail(true), trail(true), trail(true), trail(true), trail(true)],
    };

    const metric = avgPassAtK(2);

    await expect(metric(results, delta("second", true), null)).resolves.toEqual({
      "pass@k": 0.85,
    });
  });
});

describe("avgPassPowK", () => {
  it("averages unbiased pass^k estimates across tasks", async () => {
    const results = {
      first: [trail(true), trail(false), trail(true), trail(false), trail(true)],
      second: [trail(true), trail(true), trail(true), trail(true), trail(true)],
    };

    const metric = avgPassPowK(2);

    await expect(metric(results, delta("second", true), null)).resolves.toEqual({
      "pass^k": 0.65,
    });
  });
});
