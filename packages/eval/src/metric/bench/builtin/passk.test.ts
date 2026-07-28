import { Prompt } from "@open-insight/core/internal";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { avgPassAtK, avgPassPowK } from "./passk.ts";

const trail = (pass: boolean) => ({ grade: { pass }, trajectory: Prompt.empty });
const delta = (task: string, pass: boolean) => ({ ...trail(pass), task });

describe("avgPassAtK", () => {
  it("averages unbiased pass@k estimates across tasks", async () => {
    const results = {
      first: [trail(true), trail(false), trail(true), trail(false), trail(false)],
      second: [trail(true), trail(true), trail(true), trail(true), trail(true)],
    };

    const metric = await Effect.runPromise(avgPassAtK(2));

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

    const metric = await Effect.runPromise(avgPassPowK(2));

    await expect(metric(results, delta("second", true), null)).resolves.toEqual({
      "pass^k": 0.65,
    });
  });
});
