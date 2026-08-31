import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Schema, Stream } from "effect";
import { Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { DecodeFailed, StorageFailed } from "./error.ts";
import {
  makeEncoded,
  Part,
  PromptMessage,
  PromptPart,
  ResponsePart,
  Trajectory,
  TrajectoryEncoded,
  type EncodedStream,
  type PartEncoded,
  type PromptMessageEncoded,
} from "./trajectory.ts";

const Convert = Tool.make("convert", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.String,
});
const toolkit = Toolkit.make(Convert);

const userMessage = (text: string): Prompt.UserMessage =>
  Prompt.userMessage({ content: [Prompt.textPart({ text })] });

const collect = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

describe("trajectory schemas and models", () => {
  it.effect("accepts every prompt message role except assistant", () =>
    Effect.gen(function* () {
      const messages = [
        Prompt.systemMessage({ content: "system" }),
        userMessage("user"),
        Prompt.toolMessage({
          content: [
            Prompt.toolResultPart({
              id: "call-1",
              name: "convert",
              isFailure: false,
              result: "done",
              providerExecuted: false,
            }),
          ],
        }),
      ];

      for (const message of messages) {
        const decoded = yield* Schema.decodeUnknownEffect(PromptMessage)(message);
        assert.deepStrictEqual(decoded, message);
      }

      const assistant = Prompt.assistantMessage({ content: [Prompt.textPart({ text: "no" })] });
      yield* Schema.decodeUnknownEffect(PromptMessage)(assistant).pipe(Effect.flip);
    }),
  );

  it.effect("constructs and decodes prompt, response, and union parts", () =>
    Effect.gen(function* () {
      const prompt = PromptPart.make({ messages: [userMessage("hello")] });
      const decodedPrompt = yield* Schema.decodeUnknownEffect(Part(toolkit))(prompt);
      assert.strictEqual(decodedPrompt._tag, "Prompt");

      const encodedResponse = {
        _tag: "Response" as const,
        response: {
          type: "tool-call" as const,
          id: "call-1",
          name: "convert" as const,
          params: { value: "42" },
          providerExecuted: false,
        },
      };
      const response = yield* Schema.decodeUnknownEffect(ResponsePart(toolkit))(encodedResponse);
      assert.strictEqual(response.response.type, "tool-call");
      if (response.response.type === "tool-call") {
        assert.deepStrictEqual(response.response.params, { value: 42 });
      }

      const decodedResponse = yield* Schema.decodeUnknownEffect(Part(toolkit))(encodedResponse);
      assert.strictEqual(decodedResponse._tag, "Response");
    }),
  );

  it("constructs value-based trajectory containers", () => {
    const parts = Stream.empty;
    const trajectory = new Trajectory({ toolkit, parts });
    const sameTrajectory = new Trajectory({ toolkit, parts });
    const encodedParts = Stream.empty;
    const encoded = new TrajectoryEncoded({ parts: encodedParts });

    assert.strictEqual(trajectory.toolkit, toolkit);
    assert.strictEqual(trajectory.parts, parts);
    assert.isTrue(Equal.equals(trajectory, sameTrajectory));
    assert.strictEqual(encoded.parts, encodedParts);
  });
});

describe("makeEncoded", () => {
  it.effect(
    "folds streamed responses, preserves completed parts, and resets folding at prompts",
    () =>
      Effect.gen(function* () {
        const firstPrompt: PromptMessageEncoded[] = [{ role: "user", content: "first" }];
        const secondPrompt: PromptMessageEncoded[] = [{ role: "user", content: "second" }];
        const input: ReadonlyArray<PromptMessageEncoded[] | Response.AllPartsEncoded> = [
          firstPrompt,
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Hello " },
          { type: "text-delta", id: "text-1", delta: "world" },
          { type: "text-end", id: "text-1" },
          { type: "reasoning", text: "complete" },
          { type: "text-start", id: "discarded" },
          { type: "text-delta", id: "discarded", delta: "partial" },
          secondPrompt,
          { type: "text-end", id: "discarded" },
        ];

        const trajectory = yield* makeEncoded(Stream.fromIterable(input));
        const parts = yield* collect(trajectory.parts);

        assert.deepStrictEqual(parts, [
          { _tag: "Prompt", messages: firstPrompt },
          { _tag: "Response", response: { type: "text", text: "Hello world", metadata: {} } },
          {
            _tag: "Response",
            response: { type: "reasoning", text: "complete", metadata: {} },
          },
          { _tag: "Prompt", messages: secondPrompt },
        ]);
      }),
  );

  it.effect("maps source stream failures to StorageFailed", () =>
    Effect.gen(function* () {
      const cause = new Error("database unavailable");
      const source: EncodedStream<Error, never> = Stream.fail(cause);
      const trajectory = yield* makeEncoded(source);
      const error = yield* collect(trajectory.parts).pipe(Effect.flip);

      assert.instanceOf(error.reason, StorageFailed);
      assert.strictEqual(error.reason.cause, cause);
    }),
  );

  it.effect("maps invalid response payloads to DecodeFailed", () =>
    Effect.gen(function* () {
      // @ts-expect-error Simulates malformed data returned by trajectory storage.
      const source = Stream.fromIterable<Response.AllPartsEncoded>([{ type: "text", text: 123 }]);
      const trajectory = yield* makeEncoded(source);
      const error = yield* collect(trajectory.parts).pipe(Effect.flip);

      assert.instanceOf(error.reason, DecodeFailed);
    }),
  );

  it.effect("supports an empty source", () =>
    Effect.gen(function* () {
      const source: Stream.Stream<PromptMessageEncoded[] | Response.AllPartsEncoded> = Stream.empty;
      const trajectory = yield* makeEncoded(source);
      const parts: PartEncoded[] = yield* collect(trajectory.parts);
      assert.deepStrictEqual(parts, []);
    }),
  );
});
