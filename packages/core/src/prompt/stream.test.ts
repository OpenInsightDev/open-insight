import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { fromResponsePartEncodedStream } from "./stream.ts";

const run = (parts: ReadonlyArray<Response.StreamPartEncoded>) =>
  Stream.fromIterable(parts).pipe(fromResponsePartEncodedStream, Stream.runCollect);

it("accumulates text delta parts into a single text part", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "text-start", id: "t1" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "t1", delta: "Hello" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "t1", delta: " world" } as Response.StreamPartEncoded,
      { type: "text-end", id: "t1" } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text"],
    );
    assert.strictEqual(parts[0]?.type === "text" && parts[0].text, "Hello world");
  }).pipe(Effect.runPromise));

it("interleaves multiple text streams independently", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "text-start", id: "a" } as Response.StreamPartEncoded,
      { type: "text-start", id: "b" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "a", delta: "A1" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "b", delta: "B1" } as Response.StreamPartEncoded,
      { type: "text-end", id: "a" } as Response.StreamPartEncoded,
      { type: "text-end", id: "b" } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => (part.type === "text" ? part.text : part.type)),
      ["A1", "B1"],
    );
  }).pipe(Effect.runPromise));

it("accumulates reasoning delta parts into a single reasoning part", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "reasoning-start", id: "r1" } as Response.StreamPartEncoded,
      { type: "reasoning-delta", id: "r1", delta: "thinking" } as Response.StreamPartEncoded,
      { type: "reasoning-delta", id: "r1", delta: "..." } as Response.StreamPartEncoded,
      { type: "reasoning-end", id: "r1" } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["reasoning"],
    );
    assert.strictEqual(parts[0]?.type === "reasoning" && parts[0].text, "thinking...");
  }).pipe(Effect.runPromise));

it("drops deltas without a matching start and ends without a start", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "text-delta", id: "ghost", delta: "x" } as Response.StreamPartEncoded,
      { type: "text-end", id: "ghost" } as Response.StreamPartEncoded,
      { type: "reasoning-delta", id: "ghost-r", delta: "y" } as Response.StreamPartEncoded,
      { type: "reasoning-end", id: "ghost-r" } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(parts, []);
  }).pipe(Effect.runPromise));

it("forwards tool-call parts", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-call",
        id: "tc1",
        name: "get_weather",
        params: JSON.stringify({ city: "Paris" }),
        providerExecuted: true,
      } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call"],
    );
    const part = parts[0];
    assert.strictEqual(part?.type === "tool-call" && part.id, "tc1");
    assert.strictEqual(part?.type === "tool-call" && part.name, "get_weather");
    assert.strictEqual(
      part?.type === "tool-call" && part.params,
      JSON.stringify({ city: "Paris" }),
    );
    assert.strictEqual(part?.type === "tool-call" && part.providerExecuted, true);
  }).pipe(Effect.runPromise));

it("forwards final tool-result parts and drops preliminary ones", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-result",
        id: "tc1",
        name: "get_weather",
        isFailure: false,
        result: { temp: 21 },
        preliminary: true,
      } as Response.StreamPartEncoded,
      {
        type: "tool-result",
        id: "tc1",
        name: "get_weather",
        isFailure: false,
        result: { temp: 21 },
      } as Response.StreamPartEncoded,
      {
        type: "tool-result",
        id: "tc2",
        name: "boom",
        isFailure: true,
        result: "error",
      } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-result", "tool-result"],
    );

    const ok = parts[0];
    assert.strictEqual(ok?.type === "tool-result" && ok.id, "tc1");
    assert.strictEqual(ok?.type === "tool-result" && ok.name, "get_weather");
    assert.strictEqual(ok?.type === "tool-result" && ok.isFailure, false);
    assert.deepStrictEqual(ok?.type === "tool-result" && ok.result, { temp: 21 });
    assert.strictEqual(ok?.type === "tool-result" && ok.providerExecuted, false);

    const fail = parts[1];
    assert.strictEqual(fail?.type === "tool-result" && fail.isFailure, true);
    assert.strictEqual(fail?.type === "tool-result" && fail.result, "error");
  }).pipe(Effect.runPromise));

it("forwards tool-approval-request parts", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-approval-request",
        approvalId: "ap1",
        toolCallId: "tc1",
      } as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-approval-request"],
    );
    const part = parts[0];
    assert.strictEqual(part?.type === "tool-approval-request" && part.approvalId, "ap1");
    assert.strictEqual(part?.type === "tool-approval-request" && part.toolCallId, "tc1");
  }).pipe(Effect.runPromise));

it("ignores unknown part types", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "unknown", id: "x" } as unknown as Response.StreamPartEncoded,
    ]);

    assert.deepStrictEqual(parts, []);
  }).pipe(Effect.runPromise));
