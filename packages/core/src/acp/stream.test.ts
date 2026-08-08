import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { transform } from "./stream.ts";

const run = (updates: ReadonlyArray<SessionUpdate>) =>
  Stream.fromIterable(updates).pipe(transform, Stream.runCollect);

const chunk = (
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk",
  messageId: string,
  text: string,
): SessionUpdate =>
  ({ sessionUpdate, messageId, content: { type: "text", text } }) as unknown as SessionUpdate;

it("accumulates text chunks into a single text part per message and emits finish", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      chunk("agent_message_chunk", "m1", "Hello"),
      chunk("agent_message_chunk", "m1", " world"),
      chunk("agent_message_chunk", "m2", "Next"),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text", "text", "finish"],
    );
    const [first, second] = parts as Array<{ type: string; text?: string }>;
    assert.strictEqual(first.type === "text" && first.text, "Hello world");
    assert.strictEqual(second.type === "text" && second.text, "Next");
  }).pipe(Effect.runPromise));

it("accumulates reasoning chunks into a single reasoning part", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      chunk("agent_thought_chunk", "r1", "think"),
      chunk("agent_thought_chunk", "r1", "ing"),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["reasoning", "finish"],
    );
    const first = parts[0] as { type: string; text?: string };
    assert.strictEqual(first.type === "reasoning" && first.text, "thinking");
  }).pipe(Effect.runPromise));

it("interleaves text and reasoning segments independently", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      chunk("agent_message_chunk", "m1", "A"),
      chunk("agent_thought_chunk", "r1", "R1"),
      chunk("agent_message_chunk", "m1", "B"),
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text", "reasoning", "finish"],
    );
    const [first, second] = parts as Array<{ type: string; text?: string }>;
    assert.strictEqual(first.type === "text" && first.text, "AB");
    assert.strictEqual(second.type === "reasoning" && second.text, "R1");
  }).pipe(Effect.runPromise));

it("forwards tool calls and both preliminary and final tool results", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "Read file",
        name: "ReadFile",
        rawInput: { path: "/tmp/a" },
      } as unknown as SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "in_progress",
      } as unknown as SessionUpdate,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
        rawOutput: { content: "data" },
      } as unknown as SessionUpdate,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call", "tool-result", "tool-result", "finish"],
    );

    const call = parts[0] as { type: string; name?: string; params?: unknown };
    assert.strictEqual(call.type === "tool-call" && call.name, "ReadFile");
    assert.deepStrictEqual(call.type === "tool-call" && call.params, { path: "/tmp/a" });

    const preliminary = parts[1] as {
      type: string;
      preliminary?: boolean;
      isFailure?: boolean;
    };
    assert.strictEqual(preliminary.type === "tool-result" && preliminary.preliminary, true);
    assert.strictEqual(preliminary.type === "tool-result" && preliminary.isFailure, false);

    const final_ = parts[2] as {
      type: string;
      preliminary?: boolean;
      isFailure?: boolean;
      result?: unknown;
    };
    assert.strictEqual(final_.type === "tool-result" && final_.preliminary, false);
    assert.strictEqual(final_.type === "tool-result" && final_.isFailure, false);
    assert.deepStrictEqual(final_.type === "tool-result" && final_.result, { content: "data" });
  }).pipe(Effect.runPromise));

it("emits a finish part carrying usage from a usage_update", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { sessionUpdate: "usage_update", used: 42, size: 100 } as unknown as SessionUpdate,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["finish"],
    );
    const finish = parts[0] as {
      type: string;
      usage?: { inputTokens?: { total?: number } };
    };
    assert.strictEqual(finish.type === "finish" && finish.usage?.inputTokens?.total, 42);
  }).pipe(Effect.runPromise));
