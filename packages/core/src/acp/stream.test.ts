import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Option, Stream } from "effect";
import { type StreamPart, transform } from "./stream.ts";

const collect = (
  updates: ReadonlyArray<SessionUpdate>,
): Effect.Effect<Array<StreamPart>, never, never> =>
  Stream.fromIterable(updates).pipe(
    transform,
    Stream.runCollect,
    Effect.map((parts) => Array.from(parts)),
  );

const textChunk = (text: string, messageId = "message-1"): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  messageId,
  content: {
    type: "text",
    text,
  },
});

const thoughtChunk = (text: string, messageId = "thought-1"): SessionUpdate => ({
  sessionUpdate: "agent_thought_chunk",
  messageId,
  content: {
    type: "text",
    text,
  },
});

it.effect("maps agent text chunks to text stream parts and finish", () =>
  Effect.gen(function* () {
    const parts = yield* collect([textChunk("hello "), textChunk("world")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-delta", "text-end", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "text-start" && parts[0].id, "message-1");
    assert.strictEqual(parts[1]?.type === "text-delta" && parts[1].delta, "hello ");
    assert.strictEqual(parts[2]?.type === "text-delta" && parts[2].delta, "world");
  }),
);

it.effect("maps thought chunks to reasoning stream parts", () =>
  Effect.gen(function* () {
    const parts = yield* collect([thoughtChunk("thinking")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["reasoning-start", "reasoning-delta", "reasoning-end", "finish"],
    );
    assert.strictEqual(parts[1]?.type === "reasoning-delta" && parts[1].delta, "thinking");
  }),
);

it.effect("closes the active message when message id changes", () =>
  Effect.gen(function* () {
    const parts = yield* collect([textChunk("one", "one"), textChunk("two", "two")]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "text-end", "text-start", "text-delta", "text-end", "finish"],
    );
    assert.strictEqual(parts[2]?.type === "text-end" && parts[2].id, "one");
    assert.strictEqual(parts[3]?.type === "text-start" && parts[3].id, "two");
  }),
);

it.effect("maps tool events to real tool-call and tool-result parts", () =>
  Effect.gen(function* () {
    const updates: ReadonlyArray<SessionUpdate> = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Read file",
        kind: "read",
        status: "in_progress",
        rawInput: {
          path: "README.md",
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: {
          ok: true,
        },
      },
    ];

    const parts = yield* collect(updates);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call", "tool-result", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "tool-call" && parts[0].id, "tool-1");
    assert.strictEqual(parts[0]?.type === "tool-call" && parts[0].name, "read");
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].id, "tool-1");
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].isFailure, false);
    assert.strictEqual(parts[1]?.type === "tool-result" && parts[1].preliminary, false);
  }),
);

it.effect("maps in-progress tool updates to preliminary tool results", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-2",
        status: "in_progress",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "working",
            },
          },
        ],
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-result", "finish"],
    );
    assert.strictEqual(parts[0]?.type === "tool-result" && parts[0].preliminary, true);
    assert.strictEqual(parts[0]?.type === "tool-result" && parts[0].name, "acp_tool_tool_2");
  }),
);

it.effect("keeps plan and session state events as metadata", () =>
  Effect.gen(function* () {
    const updates: ReadonlyArray<SessionUpdate> = [
      {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Implement",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
      {
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      },
      {
        sessionUpdate: "session_info_update",
        title: "Session",
      },
    ];

    const parts = yield* collect(updates);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["response-metadata", "response-metadata", "response-metadata", "finish"],
    );
  }),
);

it.effect("uses usage update as finish without adding another finish", () =>
  Effect.gen(function* () {
    const parts = yield* collect([
      textChunk("done"),
      {
        sessionUpdate: "usage_update",
        used: 42,
        size: 100,
      },
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text-start", "text-delta", "finish", "text-end"],
    );
    const finish = parts.find((part) => part.type === "finish");
    assert.strictEqual(finish?.type === "finish" && finish.usage.inputTokens.total, 42);
  }),
);

it.effect("preserves upstream errors in the stream error channel", () =>
  Effect.gen(function* () {
    const error = "boom";
    const result = yield* Stream.fail(error).pipe(transform, Stream.runCollect, Effect.exit);

    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.deepStrictEqual(Cause.findErrorOption(result.cause), Option.some(error));
    }
  }),
);
