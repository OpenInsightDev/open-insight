import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Response } from "effect/unstable/ai";
import { TrailStreamEvent } from "./schema.ts";

const fields = {
  bench: "bench",
  harness: "harness",
  task: "task",
  trailIdx: 0,
};

it.effect("round-trips tool stream events", () =>
  Effect.gen(function* () {
    const toolCall = TrailStreamEvent.make({
      ...fields,
      part: Response.toolCallPart({
        id: "call",
        name: "terminal",
        params: { input: "value" },
        providerExecuted: false,
      }),
    });
    const encodedCall = yield* Schema.encodeEffect(TrailStreamEvent)(toolCall);
    const decodedCall = yield* Schema.decodeEffect(TrailStreamEvent)(encodedCall);

    if (decodedCall.part.type !== "tool-call") {
      return assert.fail(`Expected tool-call, received ${decodedCall.part.type}`);
    }
    assert.isTrue(Response.isPart(decodedCall.part));
    assert.strictEqual(decodedCall.part.name, "terminal");
    assert.deepStrictEqual(decodedCall.part.params, { input: "value" });

    const toolResult = TrailStreamEvent.make({
      ...fields,
      part: Response.toolResultPart({
        id: "call",
        name: "terminal",
        result: { decoded: "value" },
        encodedResult: { encoded: "value" },
        isFailure: false,
        providerExecuted: false,
        preliminary: false,
      }),
    });
    const encodedResult = yield* Schema.encodeEffect(TrailStreamEvent)(toolResult);
    const decodedResult = yield* Schema.decodeEffect(TrailStreamEvent)(encodedResult);

    if (decodedResult.part.type !== "tool-result") {
      return assert.fail(`Expected tool-result, received ${decodedResult.part.type}`);
    }
    assert.isTrue(Response.isPart(decodedResult.part));
    assert.strictEqual(decodedResult.part.name, "terminal");
    assert.deepStrictEqual(decodedResult.part.result, { decoded: "value" });
    assert.deepStrictEqual(decodedResult.part.encodedResult, { encoded: "value" });
  }),
);
