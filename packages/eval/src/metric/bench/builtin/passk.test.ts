import { Prompt } from "@open-insight/core/internal";
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

    await expect(avgPassAtK(2)(results, delta("second", true), null)).resolves.toEqual({
      "pass@k": 0.85,
    });
  });

  it("accepts a custom boolean grade field", async () => {
    const customTrail = (simPass: boolean) => ({ grade: { simPass }, trajectory: Prompt.empty });
    const results = {
      first: [customTrail(true), customTrail(false)],
      second: [customTrail(true), customTrail(true)],
    };

    await expect(
      avgPassAtK(1, "simPass")(results, { ...customTrail(true), task: "second" }, null),
    ).resolves.toEqual({ "pass@k": 0.75 });
  });
});

describe("avgPassPowK", () => {
  it("averages unbiased pass^k estimates across tasks", async () => {
    const results = {
      first: [trail(true), trail(false), trail(true), trail(false), trail(true)],
      second: [trail(true), trail(true), trail(true), trail(true), trail(true)],
    };

    await expect(avgPassPowK(2)(results, delta("second", true), null)).resolves.toEqual({
      "pass^k": 0.65,
    });
  });

  it("accepts a custom boolean grade field", async () => {
    const customTrail = (simPass: boolean) => ({ grade: { simPass }, trajectory: Prompt.empty });
    const results = {
      first: [customTrail(true), customTrail(false)],
      second: [customTrail(true), customTrail(true)],
    };

    await expect(
      avgPassPowK(2, "simPass")(results, { ...customTrail(true), task: "second" }, null),
    ).resolves.toEqual({ "pass^k": 0.5 });
  });
});
