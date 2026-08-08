import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { decodeResponsePartEncodedStream } from "./decode.ts";

const run = (parts: ReadonlyArray<Response.StreamPartEncoded>) =>
  Stream.fromIterable(parts).pipe(decodeResponsePartEncodedStream, Stream.runCollect);

it("decodes non-tool parts without a toolkit", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "text-start", id: "t1" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "t1", delta: "hi" } as Response.StreamPartEncoded,
      { type: "text-end", id: "t1" } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((p) => p.type),
      ["text-start", "text-delta", "text-end"],
    );
  }).pipe(Effect.runPromise));

it("decodes an arbitrarily named tool-call into a branded part", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-call",
        id: "call_1",
        name: "bash",
        params: { cmd: "ls" },
        providerExecuted: true,
      } as Response.StreamPartEncoded,
    ]);

    assert.strictEqual(parts.length, 1);
    const part = parts[0];
    assert.ok(Response.isPart(part));
    assert.strictEqual(part.type, "tool-call");
    if (part.type === "tool-call") {
      assert.strictEqual(part.name, "bash");
      assert.strictEqual(part.providerExecuted, true);
    }
  }).pipe(Effect.runPromise));

it("decodes an arbitrarily named tool-result into a branded part", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-result",
        id: "call_1",
        name: "ReadFile",
        isFailure: false,
        result: { content: "src" },
      } as Response.StreamPartEncoded,
    ]);

    assert.strictEqual(parts.length, 1);
    const part = parts[0];
    assert.ok(Response.isPart(part));
    assert.strictEqual(part.type, "tool-result");
    if (part.type === "tool-result") {
      assert.strictEqual(part.name, "ReadFile");
      assert.strictEqual(part.isFailure, false);
      assert.deepStrictEqual(part.result, { content: "src" });
    }
  }).pipe(Effect.runPromise));

it("decodes distinct tool names independently", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "tool-call", id: "a", name: "A", params: {} } as Response.StreamPartEncoded,
      {
        type: "tool-result",
        id: "b",
        name: "B",
        isFailure: true,
        result: "boom",
      } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((p) => p.type),
      ["tool-call", "tool-result"],
    );
  }).pipe(Effect.runPromise));
