import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import { make, type EncodedStream, type PromptMessageEncoded } from "./trajectory.ts";

const NumberTool = Tool.make("number", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.String,
});
const toolkit = Toolkit.make(NumberTool);

type Encoded = PromptMessageEncoded[] | Response.AllPartsEncoded;

const from = <E = never>(values: ReadonlyArray<Encoded>): EncodedStream<E, never> =>
  Stream.fromIterable(values);

it.effect("preserves prompt and folded response order", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        [
          { role: "system", content: "Be concise." },
          { role: "user", content: "First question" },
        ],
        { type: "text-start", id: "first" },
        { type: "text-delta", id: "first", delta: "First " },
        { type: "text-delta", id: "first", delta: "answer" },
        { type: "text-end", id: "first" },
        [{ role: "user", content: "Second question" }],
        { type: "text", text: "Second answer" },
      ]),
    );

    const parts = yield* trajectory.parts.pipe(Stream.runCollect);

    assert.deepStrictEqual(
      parts.map((part) => part._tag),
      ["Prompt", "Response", "Prompt", "Response"],
    );
    if (parts[0]?._tag === "Prompt") {
      assert.deepStrictEqual(
        parts[0].map((message) => message.role),
        ["system", "user"],
      );
    }
    if (parts[1]?._tag === "Response" && parts[1].type === "text") {
      assert.strictEqual(parts[1].text, "First answer");
    }
    if (parts[3]?._tag === "Response" && parts[3].type === "text") {
      assert.strictEqual(parts[3].text, "Second answer");
    }
  }),
);

it.effect("emits a prompt while the source stream remains open", () =>
  Effect.gen(function* () {
    const queue = yield* Queue.make<Encoded>();
    const trajectory = yield* make(Stream.fromQueue(queue));
    const first = yield* trajectory.parts.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);

    yield* Queue.offer(queue, [{ role: "user", content: "Question" }]);
    const parts = yield* Fiber.join(first);

    assert.lengthOf(parts, 1);
    assert.strictEqual(parts[0]?._tag, "Prompt");
  }),
);

it.effect("decodes tool calls using the merged toolkit", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        [{ role: "user", content: "Use the tool" }],
        {
          type: "tool-call",
          id: "call-1",
          name: "number",
          params: { value: "42" },
        },
      ]),
      toolkit,
    );

    const parts = yield* trajectory.parts.pipe(Stream.runCollect);
    const response = parts[1];

    assert.deepStrictEqual(Object.keys(trajectory.toolkit.tools), ["number"]);
    assert.strictEqual(response._tag, "Response");
    if (response?._tag === "Response" && response.type === "tool-call") {
      assert.deepStrictEqual(response.params, { value: 42 });
    }
  }),
);

it.effect("maps source failures to storage errors", () =>
  Effect.gen(function* () {
    const stream: EncodedStream<string, never> = from<string>([
      [{ role: "user", content: "Question" }],
    ]).pipe(Stream.concat(Stream.fail("disk unavailable")));
    const trajectory = yield* make(stream);

    const error = yield* trajectory.parts.pipe(Stream.runCollect, Effect.flip);

    assert.strictEqual(error.reason._tag, "StorageFailed");
    assert.strictEqual(error.reason.cause, "disk unavailable");
  }),
);

it.effect("maps schema failures to decode errors", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        [{ role: "user", content: "Use the tool" }],
        {
          type: "tool-call",
          id: "call-1",
          name: "number",
          params: { value: true },
        },
      ]),
      toolkit,
    );

    const error = yield* trajectory.parts.pipe(Stream.runCollect, Effect.flip);

    assert.strictEqual(error.reason._tag, "DecodeFailed");
  }),
);
