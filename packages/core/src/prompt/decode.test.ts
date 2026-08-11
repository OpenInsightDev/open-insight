import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import * as Prompt from "#/prompt/index.ts";
import { assert, it } from "@effect/vitest";

const parts: ReadonlyArray<Response.StreamPartEncoded> = [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "hello" },
  { type: "text-end", id: "t" },
  {
    type: "tool-call",
    id: "tc",
    name: "ls",
    params: JSON.stringify({ path: "/" }),
    providerExecuted: true,
  },
  {
    type: "tool-result",
    id: "tc",
    name: "ls",
    isFailure: false,
    result: JSON.stringify(["src"]),
  },
  {
    type: "finish",
    reason: "stop",
    usage: {
      inputTokens: { uncached: 0, total: 0 },
      outputTokens: { total: 0 },
    },
    response: undefined,
  },
] as ReadonlyArray<Response.StreamPartEncoded>;

it.effect("round-trips StreamPartEncoded -> AnyStreamPart -> StreamPartEncoded", () =>
  Effect.gen(function* () {
    const decoded = yield* Stream.fromIterable(parts).pipe(
      Prompt.decodeResponseStream,
      Stream.runCollect,
    );

    const reencoded = yield* Stream.fromIterable(decoded).pipe(
      Stream.mapEffect(Prompt.encodeResponseStreamPartEncoded),
      Stream.runCollect,
    );

    // Re-encoded parts must decode again, i.e. be valid wire parts.
    const redecoded = yield* Stream.fromIterable(reencoded).pipe(
      Prompt.decodeResponseStream,
      Stream.runCollect,
    );
    assert.deepStrictEqual(redecoded, decoded);
  }),
);
