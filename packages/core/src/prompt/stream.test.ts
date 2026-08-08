import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { fromResponsePartEncodedStream } from "./stream.ts";

const run = (parts: ReadonlyArray<Response.PartEncoded>) =>
  Stream.fromIterable(parts).pipe(fromResponsePartEncodedStream, Stream.runCollect);

it("converts non-streaming text parts", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "text", text: "Hello" } as Response.PartEncoded,
      { type: "text", text: " world" } as Response.PartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text", "text"],
    );
    assert.strictEqual(parts[0]?.type === "text" && parts[0].text, "Hello");
    assert.strictEqual(parts[1]?.type === "text" && parts[1].text, " world");
  }).pipe(Effect.runPromise));

it("converts non-streaming reasoning parts", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "reasoning", text: "thinking" } as Response.PartEncoded,
      { type: "reasoning", text: "..." } as Response.PartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["reasoning", "reasoning"],
    );
    assert.strictEqual(parts[0]?.type === "reasoning" && parts[0].text, "thinking");
  }).pipe(Effect.runPromise));

it("forwards tool-call parts", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      {
        type: "tool-call",
        id: "tc1",
        name: "get_weather",
        params: { city: "Paris" },
        providerExecuted: true,
      } as Response.PartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-call"],
    );
    const part = parts[0];
    assert.strictEqual(part?.type === "tool-call" && part.id, "tc1");
    assert.strictEqual(part?.type === "tool-call" && part.name, "get_weather");
    assert.deepStrictEqual(part?.type === "tool-call" && part.params, { city: "Paris" });
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
      } as Response.PartEncoded,
      {
        type: "tool-result",
        id: "tc1",
        name: "get_weather",
        isFailure: false,
        result: { temp: 21 },
      } as Response.PartEncoded,
      {
        type: "tool-result",
        id: "tc2",
        name: "boom",
        isFailure: true,
        result: "error",
      } as Response.PartEncoded,
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
      } as Response.PartEncoded,
    ]);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["tool-approval-request"],
    );
    const part = parts[0];
    assert.strictEqual(part?.type === "tool-approval-request" && part.approvalId, "ap1");
    assert.strictEqual(part?.type === "tool-approval-request" && part.toolCallId, "tc1");
  }).pipe(Effect.runPromise));

it("drops parts without a prompt part analogue", () =>
  Effect.gen(function* () {
    const parts = yield* run([
      { type: "finish", reason: "stop", usage: {} } as unknown as Response.PartEncoded,
      { type: "response-metadata", id: "m1" } as Response.PartEncoded,
      { type: "reasoning-delta", id: "r1", delta: "x" } as Response.PartEncoded,
      { type: "unknown", id: "x" } as unknown as Response.PartEncoded,
    ]);

    assert.deepStrictEqual(parts, []);
  }).pipe(Effect.runPromise));
