import { Prompt } from "@open-insight/core/internal";
import { describe, expect, it } from "vite-plus/test";
import { passAtK, passPowK } from "./passk.ts";

const trail = (pass: boolean) => ({ grade: { pass }, trajectory: Prompt.empty });

describe("passAtK", () => {
  it("returns zero when every attempt fails", async () => {
    await expect(
      passAtK(2)([trail(false), trail(false), trail(false)], trail(false), null),
    ).resolves.toEqual({
      "pass@k": 0,
    });
  });

  it("returns one when every attempt passes", async () => {
    await expect(
      passAtK(2)([trail(true), trail(true), trail(true)], trail(true), null),
    ).resolves.toEqual({
      "pass@k": 1,
    });
  });

  it("uses the unbiased pass@k estimator", async () => {
    await expect(
      passAtK(2)(
        [trail(true), trail(false), trail(true), trail(false), trail(false)],
        trail(false),
        null,
      ),
    ).resolves.toEqual({ "pass@k": 0.7 });
  });

  it("accepts grade types extending pass", async () => {
    const metric = passAtK<{ pass: boolean; score: number }>(1);

    await expect(
      metric(
        [
          { grade: { pass: false, score: 0 }, trajectory: Prompt.empty },
          { grade: { pass: true, score: 1 }, trajectory: Prompt.empty },
        ],
        { grade: { pass: true, score: 1 }, trajectory: Prompt.empty },
        null,
      ),
    ).resolves.toEqual({ "pass@k": 0.5 });
  });
});

describe("passPowK", () => {
  it("returns zero with fewer than k passing attempts", async () => {
    await expect(
      passPowK(2)([trail(true), trail(false), trail(false)], trail(false), null),
    ).resolves.toEqual({
      "pass^k": 0,
    });
  });

  it("returns one when every attempt passes", async () => {
    await expect(
      passPowK(2)([trail(true), trail(true), trail(true)], trail(true), null),
    ).resolves.toEqual({
      "pass^k": 1,
    });
  });

  it("uses the unbiased pass^k estimator", async () => {
    await expect(
      passPowK(2)(
        [trail(true), trail(false), trail(true), trail(false), trail(true)],
        trail(true),
        null,
      ),
    ).resolves.toEqual({ "pass^k": 0.3 });
  });
});
