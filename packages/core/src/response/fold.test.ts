import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response, type Tool } from "effect/unstable/ai";
import { fold } from "./fold.ts";

it.effect("folds stream parts while preserving completed response parts", () =>
  Effect.gen(function* () {
    const parts: ReadonlyArray<Response.AllParts<Record<string, Tool.Any>>> = [
      Response.makePart("text", { text: "already complete" }),
      Response.makePart("text-start", { id: "text-1" }),
      Response.makePart("text-delta", { id: "text-1", delta: " streamed" }),
      Response.makePart("text-end", { id: "text-1" }),
      Response.makePart("reasoning", { text: "already reasoned" }),
    ];

    const folded = yield* fold(Stream.fromIterable(parts)).pipe(Stream.runCollect);

    const narrowFolded: Stream.Stream<Response.Part<Record<string, Tool.Any>>> = fold(
      Stream.fromIterable(parts),
    );
    void narrowFolded;

    assert.deepStrictEqual(Array.from(folded), [
      Response.makePart("text", { text: "already complete" }),
      Response.makePart("text", { text: " streamed" }),
      Response.makePart("reasoning", { text: "already reasoned" }),
    ]);
  }),
);

it.effect("preserves unknown tool parts from an all-parts view", () =>
  Effect.gen(function* () {
    const parts: ReadonlyArray<Response.AllPartsView<Record<string, Tool.Any>>> = [
      Response.makePart("tool-call", {
        id: "unknown-tool-1",
        name: "unknown-tool",
        params: { value: 1 },
        providerExecuted: false,
      }),
    ];

    const folded = yield* fold(Stream.fromIterable(parts)).pipe(Stream.runCollect);

    assert.deepStrictEqual(Array.from(folded), parts);
  }),
);
