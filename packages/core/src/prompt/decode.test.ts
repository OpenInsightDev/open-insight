import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Response } from "effect/unstable/ai";
import { decodeResponsePartEncoded } from "./decode.ts";

const decode = (part: Response.PartEncoded) =>
  decodeResponsePartEncoded(part).pipe(Effect.runPromise);

it("decodes a non-tool part without a toolkit", async () => {
  const part = await decode({ type: "text", text: "hello" } as Response.PartEncoded);
  assert.strictEqual(part.type, "text");
  if (part.type === "text") {
    assert.strictEqual(part.text, "hello");
  }
});

it("decodes an arbitrarily named tool-call into a branded part", async () => {
  const part = await decode({
    type: "tool-call",
    id: "call_1",
    name: "bash",
    params: { cmd: "ls" },
    providerExecuted: true,
  } as Response.PartEncoded);
  assert.ok(Response.isPart(part));
  assert.strictEqual(part.type, "tool-call");
  if (part.type === "tool-call") {
    assert.strictEqual(part.name, "bash");
    assert.strictEqual(part.providerExecuted, true);
  }
});

it("decodes an arbitrarily named tool-result into a branded part", async () => {
  const part = await decode({
    type: "tool-result",
    id: "call_1",
    name: "ReadFile",
    isFailure: false,
    result: { content: "src" },
  } as Response.PartEncoded);
  assert.strictEqual(part.type, "tool-result");
  if (part.type === "tool-result") {
    assert.strictEqual(part.name, "ReadFile");
    assert.strictEqual(part.isFailure, false);
    assert.deepStrictEqual(part.result, { content: "src" });
  }
});

it("decodes a reasoning part into a branded part", async () => {
  const part = await decode({
    type: "reasoning",
    id: "r1",
    text: "thinking",
  } as Response.PartEncoded);
  assert.strictEqual(part.type, "reasoning");
});
