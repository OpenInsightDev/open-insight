import { DefaultGeneratedFile } from "ai";
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Option, Stream } from "effect";
import {
  AiSdkStreamError,
  type AiSdkStreamPart,
  fromAiStream,
  type StreamPart,
  transform,
} from "./stream.ts";

const usage = {
  inputTokens: 7,
  inputTokenDetails: {
    noCacheTokens: 5,
    cacheReadTokens: 1,
    cacheWriteTokens: 1,
  },
  outputTokens: 11,
  outputTokenDetails: {
    textTokens: 8,
    reasoningTokens: 3,
  },
  totalTokens: 18,
};

const collect = (
  parts: ReadonlyArray<AiSdkStreamPart>,
): Effect.Effect<Array<StreamPart>, never, never> =>
  Stream.fromIterable(parts).pipe(
    transform,
    Stream.runCollect,
    Effect.map((chunk) => Array.from(chunk)),
  );

it.effect("maps text and reasoning boundaries and deltas", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", text: "hello" },
      { type: "text-end", id: "text-1" },
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", text: "think" },
      { type: "reasoning-end", id: "reasoning-1" },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      [
        "text-start",
        "text-delta",
        "text-end",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
      ],
    );
    assert.strictEqual(parts[1]?.type === "text-delta" && parts[1].delta, "hello");
    assert.strictEqual(parts[4]?.type === "reasoning-delta" && parts[4].delta, "think");
  }),
);

it.effect("maps tool input, calls, results, errors, and denied outputs", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        type: "tool-input-start",
        id: "call-1",
        toolName: "lookup",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "call-1", delta: '{"q"' },
      { type: "tool-input-end", id: "call-1" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { q: "x" },
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { q: "x" },
        output: { value: 1 },
        dynamic: true,
      },
      {
        type: "tool-error",
        toolCallId: "call-2",
        toolName: "lookup",
        input: { q: "y" },
        error: "boom",
        dynamic: true,
      },
      {
        type: "tool-output-denied",
        toolCallId: "call-3",
        toolName: "lookup",
        providerExecuted: false,
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      [
        "tool-params-start",
        "tool-params-delta",
        "tool-params-end",
        "tool-call",
        "tool-result",
        "tool-result",
        "tool-result",
      ],
    );
    assert.strictEqual(parts[0]?.type === "tool-params-start" && parts[0].name, "lookup");
    assert.deepStrictEqual(parts[3]?.type === "tool-call" && parts[3].params, { q: "x" });
    assert.strictEqual(parts[4]?.type === "tool-result" && parts[4].isFailure, false);
    assert.strictEqual(parts[5]?.type === "tool-result" && parts[5].isFailure, true);
    assert.strictEqual(parts[6]?.type === "tool-result" && parts[6].isFailure, true);
  }),
);

it.effect("maps finish usage and abort", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: usage,
      },
      {
        type: "abort",
        reason: "user",
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["finish", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "finish" && parts[0].reason, "stop");
    assert.strictEqual(parts[0]?.type === "finish" && parts[0].usage.inputTokens.total, 7);
    assert.strictEqual(parts[1]?.type === "finish" && parts[1].reason, "unknown");
  }),
);

it.effect("maps files and sources, with invalid URL sources falling back to metadata", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        type: "file",
        file: new DefaultGeneratedFile({
          data: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
        }),
      },
      {
        type: "reasoning-file",
        file: new DefaultGeneratedFile({
          data: new Uint8Array([4]),
          mediaType: "application/octet-stream",
        }),
      },
      {
        type: "source",
        sourceType: "url",
        id: "source-1",
        url: "https://example.com",
        title: "Example",
      },
      {
        type: "source",
        sourceType: "document",
        id: "source-2",
        mediaType: "application/pdf",
        title: "Doc",
        filename: "doc.pdf",
      },
      {
        type: "source",
        sourceType: "url",
        id: "source-3",
        url: "not a url",
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["file", "file", "source", "source", "response-metadata"],
    );
    assert.strictEqual(parts[0]?.type === "file" && parts[0].mediaType, "image/png");
    assert.strictEqual(parts[2]?.type === "source" && parts[2].sourceType, "url");
    assert.strictEqual(parts[3]?.type === "source" && parts[3].sourceType, "document");
  }),
);

it.effect("keeps lifecycle, custom, raw, and approval response events as metadata", () =>
  Effect.gen(function* () {
    const toolCall = {
      type: "tool-call" as const,
      toolCallId: "call-1",
      toolName: "lookup",
      input: {},
      dynamic: true as const,
    };
    const parts = yield* collect([
      { type: "start" },
      { type: "start-step", request: {}, warnings: [] },
      {
        type: "finish-step",
        response: {
          id: "response-1",
          timestamp: new Date("2026-06-30T00:00:00.000Z"),
          modelId: "model-1",
        },
        usage,
        performance: {
          stepTimeMs: 1,
          responseTimeMs: 1,
          toolExecutionMs: {},
          outputTokensPerSecond: undefined,
          inputTokensPerSecond: undefined,
          effectiveOutputTokensPerSecond: 1,
          effectiveTotalTokensPerSecond: 1,
          timeToFirstOutputMs: undefined,
        },
        finishReason: "stop",
        rawFinishReason: "stop",
        providerMetadata: undefined,
      },
      { type: "custom", kind: "test.event" },
      { type: "raw", rawValue: { ok: true } },
      {
        type: "tool-approval-response",
        approvalId: "approval-1",
        toolCall,
        approved: true,
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      [
        "response-metadata",
        "response-metadata",
        "response-metadata",
        "response-metadata",
        "response-metadata",
        "response-metadata",
      ],
    );
  }),
);

it.effect("maps approval requests and streamed error parts", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        type: "tool-approval-request",
        approvalId: "approval-1",
        toolCall: {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "lookup",
          input: {},
          dynamic: true,
        },
      },
      {
        type: "error",
        error: "bad chunk",
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-approval-request", "error"],
    );
    assert.strictEqual(
      parts[0]?.type === "tool-approval-request" && parts[0].approvalId,
      "approval-1",
    );
    assert.strictEqual(parts[1]?.type === "error" && parts[1].error, "bad chunk");
  }),
);

it.effect("preserves upstream Effect stream errors in the error channel", () =>
  Effect.gen(function* () {
    const error = "boom";
    const result = yield* Stream.fail(error).pipe(transform, Stream.runCollect, Effect.exit);

    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.deepStrictEqual(Cause.findErrorOption(result.cause), Option.some(error));
    }
  }),
);

it.effect("wraps async iterable errors in AiSdkStreamError", () =>
  Effect.gen(function* () {
    async function* failingStream(): AsyncIterable<AiSdkStreamPart> {
      yield { type: "text-start", id: "text-1" };
      throw new Error("stream failed");
    }

    const result = yield* fromAiStream(failingStream()).pipe(Stream.runCollect, Effect.exit);

    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      const error = Cause.findErrorOption(result.cause);
      assert.strictEqual(Option.isSome(error), true);
      if (Option.isSome(error)) {
        assert.strictEqual(error.value instanceof AiSdkStreamError, true);
      }
    }
  }),
);
