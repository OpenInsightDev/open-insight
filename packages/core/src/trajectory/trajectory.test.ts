import { assert, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Response, Tool, Toolkit } from "effect/unstable/ai";
import { make, type PromptMessageEncoded } from "./trajectory.ts";

const NumberTool = Tool.make("number", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.String,
});
const toolkit = Toolkit.make(NumberTool);

type Encoded = PromptMessageEncoded | Response.AllPartsEncoded;

const from = (values: ReadonlyArray<Encoded>) => Stream.fromIterable(values);

it.effect("splits turns and folds streaming response parts", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        { role: "system", content: "Be concise." },
        { role: "user", content: "First question" },
        { type: "text-start", id: "first" },
        { type: "text-delta", id: "first", delta: "First " },
        { type: "text-delta", id: "first", delta: "answer" },
        { type: "text-end", id: "first" },
        { role: "user", content: "Second question" },
        { type: "text", text: "Second answer" },
      ]),
    );

    const turns = yield* trajectory.turns().pipe(Stream.runCollect);

    assert.lengthOf(turns, 2);
    assert.deepStrictEqual(
      turns.map((turn) => turn.prompt.map((message) => message.role)),
      [["system", "user"], ["user"]],
    );
    assert.deepStrictEqual(yield* turns[0]!.response.pipe(Stream.runCollect), [
      Response.makePart("text", { text: "First answer" }),
    ]);
    assert.deepStrictEqual(yield* turns[1]!.response.pipe(Stream.runCollect), [
      Response.makePart("text", { text: "Second answer" }),
    ]);
  }),
);

it.effect("keeps a trailing unanswered prompt as an empty-response turn", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        { role: "user", content: "Answered" },
        { type: "text", text: "Answer" },
        { role: "user", content: "Pending" },
      ]),
    );

    const turns = yield* trajectory.turns().pipe(Stream.runCollect);

    assert.lengthOf(turns, 2);
    assert.strictEqual(turns[1]!.prompt[0]!.role, "user");
    assert.isEmpty(yield* turns[1]!.response.pipe(Stream.runCollect));
  }),
);

it.effect("decodes tool calls using the merged toolkit", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        { role: "user", content: "Use the tool" },
        {
          type: "tool-call",
          id: "call-1",
          name: "number",
          params: { value: "42" },
        },
      ]),
      toolkit,
    );

    const turns = yield* trajectory.turns().pipe(Stream.runCollect);
    const parts = yield* turns[0]!.response.pipe(Stream.runCollect);

    assert.deepStrictEqual(Object.keys(trajectory.toolkit.tools), ["number"]);
    assert.strictEqual(parts[0]?.type, "tool-call");
    if (parts[0]?.type === "tool-call") {
      assert.deepStrictEqual(parts[0].params, { value: 42 });
    }
  }),
);

it.effect("maps source failures to storage errors", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([{ role: "user", content: "Question" }]).pipe(
        Stream.concat(Stream.fail("disk unavailable")),
      ),
    );

    const error = yield* trajectory.turns().pipe(Stream.runCollect, Effect.flip);

    assert.strictEqual(error.reason._tag, "StorageFailed");
    assert.strictEqual(error.reason.cause, "disk unavailable");
  }),
);

it.effect("maps schema failures to decode errors", () =>
  Effect.gen(function* () {
    const trajectory = yield* make(
      from([
        { role: "user", content: "Use the tool" },
        {
          type: "tool-call",
          id: "call-1",
          name: "number",
          params: { value: true },
        },
      ]),
      toolkit,
    );

    const error = yield* trajectory.turns().pipe(Stream.runCollect, Effect.flip);

    assert.strictEqual(error.reason._tag, "DecodeFailed");
  }),
);
