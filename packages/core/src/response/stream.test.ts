import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { merge } from "./stream.ts";
import type { AnyStreamPart } from "./schema.ts";

const collectStream = <E, R>(stream: Stream.Stream<AnyStreamPart, E, R>) =>
  Stream.runCollect(merge(stream)).pipe(Effect.map((chunk) => Array.from(chunk)));

it.effect("merges text stream parts into a text part", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "text-start", id: "1" } as any,
        { type: "text-delta", id: "1", delta: "Hello" } as any,
        { type: "text-delta", id: "1", delta: " world" } as any,
        { type: "text-end", id: "1" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [Response.makePart("text", { text: "Hello world" })]);
  }),
);

it.effect("merges reasoning stream parts into a reasoning part", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "reasoning-start", id: "1" } as any,
        { type: "reasoning-delta", id: "1", delta: "Thinking" } as any,
        { type: "reasoning-delta", id: "1", delta: "..." } as any,
        { type: "reasoning-end", id: "1" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [Response.makePart("reasoning", { text: "Thinking..." })]);
  }),
);

it.effect("merges tool params stream parts into a tool-call part", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "tool-params-start", id: "1", name: "test-tool", providerExecuted: false } as any,
        { type: "tool-params-delta", id: "1", delta: '{"key":' } as any,
        { type: "tool-params-delta", id: "1", delta: '"value"}' } as any,
        { type: "tool-params-end", id: "1" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [
      Response.makePart("tool-call", {
        id: "1",
        name: "test-tool",
        params: { key: "value" },
        providerExecuted: false,
      }),
    ]);
  }),
);

it.effect("handles invalid JSON in tool params gracefully", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "tool-params-start", id: "1", name: "test-tool", providerExecuted: true } as any,
        { type: "tool-params-delta", id: "1", delta: "invalid json" } as any,
        { type: "tool-params-end", id: "1" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [
      Response.makePart("tool-call", {
        id: "1",
        name: "test-tool",
        params: undefined,
        providerExecuted: true,
      }),
    ]);
  }),
);

it.effect("passes through non-stream parts unchanged", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "file", url: "test.txt", mediaType: "text/plain" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [{ type: "file", url: "test.txt", mediaType: "text/plain" }]);
  }),
);

it.effect("handles empty stream", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(Stream.fromIterable<AnyStreamPart>([]));
    assert.deepStrictEqual(result, []);
  }),
);

it.effect("handles multiple text sequences", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "text-start", id: "1" } as any,
        { type: "text-delta", id: "1", delta: "First" } as any,
        { type: "text-end", id: "1" } as any,
        { type: "text-start", id: "2" } as any,
        { type: "text-delta", id: "2", delta: "Second" } as any,
        { type: "text-end", id: "2" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [
      Response.makePart("text", { text: "First" }),
      Response.makePart("text", { text: "Second" }),
    ]);
  }),
);

it.effect("handles providerExecuted true in tool params", () =>
  Effect.gen(function* () {
    const result = yield* collectStream(
      Stream.fromIterable<AnyStreamPart>([
        { type: "tool-params-start", id: "1", name: "exec-tool", providerExecuted: true } as any,
        { type: "tool-params-delta", id: "1", delta: "{}" } as any,
        { type: "tool-params-end", id: "1" } as any,
      ]),
    );
    assert.deepStrictEqual(result, [
      Response.makePart("tool-call", {
        id: "1",
        name: "exec-tool",
        params: {},
        providerExecuted: true,
      }),
    ]);
  }),
);
