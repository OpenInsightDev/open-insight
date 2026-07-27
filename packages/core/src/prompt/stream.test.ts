import { assert, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import { fromResponsePartStreamEncoded } from "./stream.ts";

const Lookup = Tool.make("Lookup", {
  parameters: Schema.Struct({ at: Schema.DateFromString }),
  success: Schema.String,
});

const toolkit = Toolkit.make(Lookup);

it.effect("defaults to an empty toolkit", () =>
  Effect.gen(function* () {
    const parts = yield* Stream.make(
      Response.makePart("text-start", { id: "text-1" }),
      Response.makePart("text-delta", { id: "text-1", delta: "hello" }),
      Response.makePart("text-end", { id: "text-1" }),
    ).pipe((stream) => fromResponsePartStreamEncoded(stream), Stream.runCollect);

    assert.deepStrictEqual(Array.from(parts), [{ type: "text", text: "hello" }]);
  }),
);

it.effect("encodes response stream parts with the toolkit schemas", () =>
  Effect.gen(function* () {
    const at = new Date("2026-07-27T12:00:00.000Z");
    const part = Response.makePart("tool-call", {
      id: "call-1",
      name: "Lookup",
      params: { at },
      providerExecuted: false,
    });

    const parts = yield* Stream.make(part).pipe(
      (stream) => fromResponsePartStreamEncoded(stream, toolkit),
      Stream.runCollect,
    );

    assert.deepStrictEqual(Array.from(parts), [
      {
        type: "tool-call",
        id: "call-1",
        name: "Lookup",
        params: { at: "2026-07-27T12:00:00.000Z" },
        providerExecuted: false,
      },
    ]);
  }),
);
