import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { fromResponsePartEncodedStream } from "./stream.ts";

it("converts encoded response stream parts into prompt parts", () =>
  Effect.gen(function* () {
    const parts = yield* Stream.fromIterable([
      { type: "text-start", id: "t1" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "t1", delta: "Hello" } as Response.StreamPartEncoded,
      { type: "text-delta", id: "t1", delta: " world" } as Response.StreamPartEncoded,
      { type: "text-end", id: "t1" } as Response.StreamPartEncoded,
    ]).pipe(fromResponsePartEncodedStream, Stream.runCollect);

    assert.deepStrictEqual(
      parts.map((part) => part.type),
      ["text"],
    );
    assert.strictEqual(parts[0]?.type === "text" && parts[0].text, "Hello world");
  }).pipe(Effect.runPromise));
