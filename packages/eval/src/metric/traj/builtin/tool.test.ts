import { Prompt } from "@open-insight/core/internal";
import { describe, expect, it } from "vite-plus/test";
import { partCount, toolCallCount, toolCallSuccessRate } from "./tool.ts";

const call = (id: string, name: string) =>
  Prompt.toolCallPart({ id, name, params: {}, providerExecuted: false });
const result = (id: string, name: string, isFailure: boolean) =>
  Prompt.toolResultPart({ id, name, isFailure, result: null });

const previousTrajectory = Prompt.make([
  Prompt.assistantMessage({
    content: [call("previous-read", "read"), call("previous-bash", "bash")],
  }),
  Prompt.toolMessage({
    content: [result("previous-read", "read", false), result("previous-bash", "bash", true)],
  }),
]);

const context = {
  parts: [call("current-read", "read"), result("current-read", "read", false)],
  prevTrajectory: previousTrajectory,
};

describe("partCount", () => {
  it("counts previous and current trajectory parts", async () => {
    await expect(partCount()(context)).resolves.toEqual({ count: 6 });
    await expect(partCount("tool-result")(context)).resolves.toEqual({ count: 3 });
  });
});

describe("toolCallCount", () => {
  it("counts all calls or calls to one tool", async () => {
    await expect(toolCallCount()(context)).resolves.toEqual({ count: 3 });
    await expect(toolCallCount("read")(context)).resolves.toEqual({ count: 2 });
    await expect(toolCallCount("write")(context)).resolves.toEqual({ count: 0 });
  });
});

describe("toolCallSuccessRate", () => {
  it("uses completed calls and supports filtering by tool name", async () => {
    await expect(toolCallSuccessRate()(context)).resolves.toEqual({ rate: 2 / 3 });
    await expect(toolCallSuccessRate("read")(context)).resolves.toEqual({ rate: 1 });
    await expect(toolCallSuccessRate("bash")(context)).resolves.toEqual({ rate: 0 });
  });

  it("returns zero before a matching call completes", async () => {
    await expect(
      toolCallSuccessRate("write")({
        parts: [call("current-write", "write")],
        prevTrajectory: Prompt.empty,
      }),
    ).resolves.toEqual({ rate: 0 });
  });
});
