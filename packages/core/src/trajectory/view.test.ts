import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { make, type EncodedStream, type PromptMessageEncoded } from "./trajectory.ts";
import { messages, prompts, responses, turns } from "./view.ts";

type Encoded = PromptMessageEncoded[] | Response.AllPartsEncoded;

const from = (values: ReadonlyArray<Encoded>): EncodedStream<never, never> =>
  Stream.fromIterable(values);

it.effect("groups parts into turns and flushes the final prompt", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        [{ role: "user", content: "First question" }],
        { type: "text", text: "First answer" },
        [{ role: "user", content: "Pending question" }],
      ]),
    );

    const result = yield* turns(trajectory).pipe(Stream.runCollect);

    assert.lengthOf(result, 2);
    assert.strictEqual(result[0]?.prompt[0]?.role, "user");
    assert.strictEqual(result[0]?.response[0]?.type, "text");
    if (result[0]?.response[0]?.type === "text") {
      assert.strictEqual(result[0].response[0].text, "First answer");
    }
    assert.strictEqual(result[1]?.prompt[0]?.role, "user");
    assert.isEmpty(result[1]?.response ?? []);
  }),
);

it.effect("projects prompts and responses from trajectory parts", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([[{ role: "user", content: "Question" }], { type: "text", text: "Answer" }]),
    );

    const promptParts = yield* prompts(trajectory).pipe(Stream.runCollect);
    const responseParts = yield* responses(trajectory).pipe(Stream.runCollect);

    assert.lengthOf(promptParts, 1);
    assert.strictEqual(promptParts[0]?.[0]?.role, "user");
    assert.strictEqual(responseParts[0]?.type, "text");
    if (responseParts[0]?.type === "text") {
      assert.strictEqual(responseParts[0].text, "Answer");
    }
  }),
);

it.effect("converts turns to prompt messages", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([[{ role: "user", content: "Question" }], { type: "text", text: "Answer" }]),
    );

    const result = yield* messages(trajectory).pipe(Stream.runCollect);

    assert.deepStrictEqual(
      result.map((message) => message.role),
      ["user", "assistant"],
    );
  }),
);
