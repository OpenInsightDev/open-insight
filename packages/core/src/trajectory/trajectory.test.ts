import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { type EncodedStream, makeEncoded, type PartEncoded } from "./trajectory.ts";

it.effect("constructs an encoded trajectory from prompt and response stream parts", () =>
  Effect.gen(function* () {
    const stream: EncodedStream<never, never> = Stream.fromIterable([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "hello" },
      { type: "text-end", id: "text-1" },
      [],
      { type: "file", mediaType: "text/plain", data: "AQID" },
    ]);

    const trajectory = yield* makeEncoded(stream);
    const parts = yield* Stream.runCollect(trajectory.parts);

    assert.deepStrictEqual(Array.from(parts), [
      { _tag: "Response", response: { type: "text", text: "hello", metadata: {} } },
      { _tag: "Prompt", messages: [] },
      {
        _tag: "Response",
        response: { type: "file", mediaType: "text/plain", data: "AQID", metadata: {} },
      },
    ] satisfies ReadonlyArray<PartEncoded>);
  }),
);
