import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { decodeResponseStream } from "./decode.ts";

const decodeStream = (parts: ReadonlyArray<Response.StreamPartEncoded>) =>
  Stream.fromIterable(parts).pipe(decodeResponseStream, Stream.runCollect).pipe(Effect.runPromise);

it("decodes a stream of stream-encoded parts, one typed part per event", async () => {
  const parts = await decodeStream([
    { type: "text-start", id: "t1" } as Response.StreamPartEncoded,
    { type: "text-delta", id: "t1", delta: "Hello" } as Response.StreamPartEncoded,
    { type: "text-end", id: "t1" } as Response.StreamPartEncoded,
    { type: "reasoning-start", id: "r1" } as Response.StreamPartEncoded,
    { type: "reasoning-delta", id: "r1", delta: "thinking" } as Response.StreamPartEncoded,
    { type: "reasoning-end", id: "r1" } as Response.StreamPartEncoded,
  ]);

  assert.deepStrictEqual(
    parts.map((part) => part.type),
    ["text-start", "text-delta", "text-end", "reasoning-start", "reasoning-delta", "reasoning-end"],
  );
  assert.strictEqual(parts[0]?.type === "text-start" && parts[0].id, "t1");
  assert.strictEqual(parts[1]?.type === "text-delta" && parts[1].delta, "Hello");
  const reason = parts[4];
  assert.strictEqual(reason?.type === "reasoning-delta" && reason.delta, "thinking");
});

it("decodes an arbitrarily named tool-call into a branded part", async () => {
  const parts = await decodeStream([
    {
      type: "tool-call",
      id: "call_1",
      name: "bash",
      params: { cmd: "ls" },
      providerExecuted: true,
    } as Response.StreamPartEncoded,
  ]);

  const part = parts[0];
  assert.ok(Response.isPart(part));
  assert.strictEqual(part?.type === "tool-call" && part.name, "bash");
  assert.strictEqual(part?.type === "tool-call" && part.providerExecuted, true);
});

it("decodes an arbitrarily named streaming tool-result part", async () => {
  const parts = await decodeStream([
    {
      type: "tool-result",
      id: "call_1",
      name: "ReadFile",
      isFailure: false,
      result: { content: "src" },
    } as Response.StreamPartEncoded,
  ]);

  const part = parts[0];
  assert.strictEqual(part?.type === "tool-result" && part.name, "ReadFile");
  assert.strictEqual(part?.type === "tool-result" && part.isFailure, false);
  assert.deepStrictEqual(part?.type === "tool-result" && part.result, { content: "src" });
});
