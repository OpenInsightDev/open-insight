import { assert, describe, it } from "@effect/vitest";
import { Response } from "effect/unstable/ai";

import { buildStreamingMessageModel, type StreamingMessagePart } from "./stream-parts.ts";

const usage = {
  inputTokens: {
    uncached: undefined,
    total: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
};

describe("buildStreamingMessageModel", () => {
  it("aggregates text, reasoning, and finish into one message model", () => {
    const parts = [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "hello " },
      { type: "text-delta", id: "text-1", delta: "world" },
      { type: "text-end", id: "text-1" },
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "thinking" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "finish", reason: "stop", usage },
    ] satisfies ReadonlyArray<StreamingMessagePart>;

    const model = buildStreamingMessageModel(parts);

    assert.strictEqual(model.message.text, "hello world");
    assert.strictEqual(model.message.reasoning, "thinking");
    assert.strictEqual(model.message.status, "complete");
    assert.deepStrictEqual(
      model.debugSegments.map((segment) => segment.kind),
      ["text", "reasoning"],
    );
  });

  it("maps tool params, results, failures, and approvals", () => {
    const parts = [
      {
        type: "tool-params-start",
        id: "tool-1",
        name: "lookup",
        providerExecuted: false,
      },
      { type: "tool-params-delta", id: "tool-1", delta: '{"q"' },
      { type: "tool-params-end", id: "tool-1" },
      {
        type: "tool-call",
        id: "tool-1",
        name: "lookup",
        params: { q: "docs" },
        providerExecuted: false,
      },
      {
        type: "tool-result",
        id: "tool-1",
        name: "lookup",
        result: { progress: 1 },
        isFailure: false,
        preliminary: true,
        providerExecuted: false,
      },
      {
        type: "tool-result",
        id: "tool-1",
        name: "lookup",
        result: { ok: true },
        isFailure: false,
        preliminary: false,
        providerExecuted: false,
      },
      {
        type: "tool-result",
        id: "tool-2",
        name: "write_file",
        result: { message: "denied" },
        isFailure: true,
        providerExecuted: false,
      },
      {
        type: "tool-approval-request",
        approvalId: "approval-1",
        toolCallId: "tool-3",
      },
    ] satisfies ReadonlyArray<StreamingMessagePart>;

    const model = buildStreamingMessageModel(parts);

    assert.strictEqual(model.message.status, "failed");
    assert.strictEqual(model.message.tools.length, 3);
    assert.strictEqual(model.message.tools[0]?.status, "complete");
    assert.deepStrictEqual(model.message.tools[0]?.params, { q: "docs" });
    assert.deepStrictEqual(model.message.tools[0]?.result, { ok: true });
    assert.strictEqual(model.message.tools[1]?.status, "failed");
    assert.strictEqual(model.message.tools[2]?.status, "approval-required");
    assert.strictEqual(model.message.tools[2]?.approvalId, "approval-1");
  });

  it("collects files, sources, and streamed errors", () => {
    const parts = [
      {
        type: "file",
        mediaType: "text/plain",
        data: "hello",
      },
      {
        type: "source",
        sourceType: "url",
        id: "source-1",
        title: "Docs",
        url: "https://example.com/docs",
      },
      {
        type: "source",
        sourceType: "document",
        id: "source-2",
        title: "Spec",
        mediaType: "application/pdf",
        fileName: "spec.pdf",
      },
      {
        type: "error",
        error: "bad chunk",
      },
    ] satisfies ReadonlyArray<StreamingMessagePart>;

    const model = buildStreamingMessageModel(parts);

    assert.strictEqual(model.message.status, "failed");
    assert.strictEqual(model.message.attachments.length, 1);
    assert.strictEqual(model.message.attachments[0]?.byteLength, 5);
    assert.strictEqual(model.message.sources.length, 2);
    assert.strictEqual(model.message.errors.length, 1);
  });

  it("uses finish to close still-active content and tool segments", () => {
    const parts = [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "partial" },
      {
        type: "tool-params-start",
        id: "tool-1",
        name: "lookup",
        providerExecuted: false,
      },
      { type: "finish", reason: "stop", usage },
    ] satisfies ReadonlyArray<StreamingMessagePart>;

    const model = buildStreamingMessageModel(parts);
    const text = model.debugSegments.find((segment) => segment.kind === "text");
    const tool = model.debugSegments.find((segment) => segment.kind === "tool");

    assert.strictEqual(text?.kind === "text" && text.status, "complete");
    assert.strictEqual(tool?.kind === "tool" && tool.status, "ready");
    assert.strictEqual(model.message.status, "ready");
  });

  it("accepts both encoded objects and decoded Effect response parts", () => {
    const decodedStart = Response.makePart("text-start", { id: "decoded-text" });
    const decodedDelta = Response.makePart("text-delta", {
      id: "decoded-text",
      delta: "decoded",
    });
    const decodedToolCall = Response.toolCallPart({
      id: "decoded-tool",
      name: "lookup",
      params: { q: "docs" },
      providerExecuted: false,
    });
    const decodedToolResult = Response.toolResultPart({
      id: "decoded-tool",
      name: "lookup",
      result: { ok: true },
      encodedResult: { ok: true },
      isFailure: false,
      preliminary: false,
      providerExecuted: false,
    });
    const parts = [
      decodedStart,
      decodedDelta,
      decodedToolCall,
      decodedToolResult,
    ] satisfies ReadonlyArray<StreamingMessagePart>;

    const model = buildStreamingMessageModel(parts);

    assert.strictEqual(model.message.text, "decoded");
    assert.strictEqual(model.message.tools[0]?.status, "complete");
    assert.deepStrictEqual(model.message.tools[0]?.result, { ok: true });
  });
});
