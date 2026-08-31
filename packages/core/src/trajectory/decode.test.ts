import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { decode, encode, toolkits } from "./decode.ts";
import { DecodeFailed } from "./error.ts";
import { Trajectory, TrajectoryEncoded, type Part, type PartEncoded } from "./trajectory.ts";

const Convert = Tool.make("convert", {
  parameters: Schema.Struct({ value: Schema.NumberFromString }),
  success: Schema.NumberFromString,
});
const Label = Tool.make("label", {
  parameters: Schema.Struct({ value: Schema.String }),
  success: Schema.String,
});
const convertToolkit = Toolkit.make(Convert);
const labelToolkit = Toolkit.make(Label);

const collect = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

describe("encode", () => {
  it.effect("encodes prompt messages and known tool payloads", () =>
    Effect.gen(function* () {
      const source = new Trajectory({
        toolkit: convertToolkit,
        parts: Stream.fromIterable<Part<Toolkit.Tools<typeof convertToolkit>>>([
          {
            _tag: "Prompt",
            messages: [Prompt.userMessage({ content: [Prompt.textPart({ text: "convert it" })] })],
          },
          {
            _tag: "Response",
            response: Response.toolCallPart({
              id: "call-1",
              name: "convert",
              params: { value: 12 },
              providerExecuted: false,
            }),
          },
        ]),
      });

      const encoded = yield* encode(source);
      const parts = yield* collect(encoded.parts);

      assert.deepStrictEqual(parts, [
        {
          _tag: "Prompt",
          messages: [{ role: "user", content: "convert it", options: {} }],
        },
        {
          _tag: "Response",
          response: {
            type: "tool-call",
            id: "call-1",
            name: "convert",
            params: { value: "12" },
            providerExecuted: false,
            metadata: {},
          },
        },
      ]);
    }),
  );
});

describe("decode", () => {
  it.effect("decodes prompt messages and known tool call and result payloads", () =>
    Effect.gen(function* () {
      const encodedParts: PartEncoded[] = [
        { _tag: "Prompt", messages: [{ role: "user", content: "convert it" }] },
        {
          _tag: "Response",
          response: {
            type: "tool-call",
            id: "call-1",
            name: "convert",
            params: { value: "12" },
            providerExecuted: false,
          },
        },
        {
          _tag: "Response",
          response: {
            type: "tool-result",
            id: "call-1",
            name: "convert",
            isFailure: false,
            result: "24",
            providerExecuted: false,
            preliminary: false,
          },
        },
      ];
      const encoded = new TrajectoryEncoded({ parts: Stream.fromIterable(encodedParts) });
      const trajectory = yield* decode(encoded, convertToolkit);
      const parts = yield* collect(trajectory.parts);

      assert.strictEqual(trajectory.toolkit.tools.convert, Convert);
      assert.strictEqual(parts[0]?._tag, "Prompt");
      if (parts[0]?._tag === "Prompt") {
        const message = parts[0].messages[0];
        assert.strictEqual(message?.role, "user");
        if (message?.role === "user") {
          assert.strictEqual(message.content[0]?.type, "text");
        }
      }
      const call = parts[1]?._tag === "Response" ? parts[1].response : undefined;
      assert.strictEqual(call?.type, "tool-call");
      if (call?.type === "tool-call") {
        assert.deepStrictEqual(call.params, { value: 12 });
      }
      const result = parts[2]?._tag === "Response" ? parts[2].response : undefined;
      assert.strictEqual(result?.type, "tool-result");
      if (result?.type === "tool-result") {
        assert.strictEqual(result.result, 24);
        assert.strictEqual(result.encodedResult, "24");
      }
    }),
  );

  it.effect("preserves unknown tool parts as view values", () =>
    Effect.gen(function* () {
      const encoded = new TrajectoryEncoded({
        parts: Stream.fromIterable<PartEncoded>([
          {
            _tag: "Response",
            response: {
              type: "tool-call",
              id: "unknown-1",
              name: "unknown",
              params: { untouched: true },
              providerExecuted: true,
            },
          },
        ]),
      });
      const trajectory = yield* decode(encoded, convertToolkit);
      const parts = yield* collect(trajectory.parts);
      const response = parts[0]?._tag === "Response" ? parts[0].response : undefined;

      assert.strictEqual(response?.type, "tool-call");
      if (response?.type === "tool-call") {
        assert.strictEqual(response.name, "unknown");
        assert.deepStrictEqual(response.params, { untouched: true });
      }
    }),
  );

  it.effect("merges multiple toolkits", () =>
    Effect.gen(function* () {
      const encoded = new TrajectoryEncoded({ parts: Stream.empty });
      const trajectory = yield* decode(encoded, convertToolkit, labelToolkit);

      assert.deepStrictEqual(Object.keys(trajectory.toolkit.tools).sort(), ["convert", "label"]);
    }),
  );

  it.effect("maps malformed trajectory parts to DecodeFailed", () =>
    Effect.gen(function* () {
      // @ts-expect-error Simulates a malformed persisted trajectory part.
      const malformedParts = Stream.fromIterable<PartEncoded>([
        { _tag: "Response", response: { type: "text", text: 1 } },
      ]);
      const encoded = new TrajectoryEncoded({ parts: malformedParts });
      const trajectory = yield* decode(encoded, convertToolkit);
      const error = yield* collect(trajectory.parts).pipe(Effect.flip);

      assert.instanceOf(error.reason, DecodeFailed);
    }),
  );
});

describe("toolkits", () => {
  it.effect("adds toolkits and re-decodes previously unknown tool parts", () =>
    Effect.gen(function* () {
      const prompt = {
        _tag: "Prompt" as const,
        messages: [Prompt.userMessage({ content: [Prompt.textPart({ text: "convert" })] })],
      };
      const unknownCall: Part<{}> = {
        _tag: "Response",
        response: yield* Schema.decodeUnknownEffect(Response.PartView(Toolkit.empty))({
          type: "tool-call",
          id: "call-1",
          name: "convert",
          params: { value: "7" },
          providerExecuted: false,
        }),
      };
      const source = new Trajectory({
        toolkit: Toolkit.empty,
        parts: Stream.fromIterable<Part<{}>>([prompt, unknownCall]),
      });

      const trajectory = yield* toolkits(convertToolkit, labelToolkit)(source);
      const parts = yield* collect(trajectory.parts);
      const response = parts[1]?._tag === "Response" ? parts[1].response : undefined;

      assert.deepStrictEqual(Object.keys(trajectory.toolkit.tools).sort(), ["convert", "label"]);
      assert.strictEqual(parts[0]?._tag, "Prompt");
      assert.strictEqual(response?.type, "tool-call");
      if (response?.type === "tool-call") {
        assert.deepStrictEqual(response.params, { value: 7 });
      }
    }),
  );

  it.effect("preserves already-decoded tools while adding new ones", () =>
    Effect.gen(function* () {
      const part: Part<Toolkit.Tools<typeof convertToolkit>> = {
        _tag: "Response",
        response: Response.toolCallPart({
          id: "call-1",
          name: "convert",
          params: { value: 3 },
          providerExecuted: false,
        }),
      };
      const source = new Trajectory({
        toolkit: convertToolkit,
        parts: Stream.succeed(part),
      });

      const trajectory = yield* toolkits(labelToolkit)(source);
      const parts = yield* collect(trajectory.parts);
      const response = parts[0]?._tag === "Response" ? parts[0].response : undefined;

      assert.strictEqual(response?.type, "tool-call");
      if (response?.type === "tool-call") {
        assert.deepStrictEqual(response.params, { value: 3 });
      }
    }),
  );

  it.effect("maps payloads invalid for a newly known tool to DecodeFailed", () =>
    Effect.gen(function* () {
      const invalidCall: Part<{}> = {
        _tag: "Response",
        response: yield* Schema.decodeUnknownEffect(Response.PartView(Toolkit.empty))({
          type: "tool-call",
          id: "call-1",
          name: "convert",
          params: { value: null },
          providerExecuted: false,
        }),
      };
      const source = new Trajectory({
        toolkit: Toolkit.empty,
        parts: Stream.succeed(invalidCall),
      });
      const trajectory = yield* toolkits(convertToolkit)(source);
      const error = yield* collect(trajectory.parts).pipe(Effect.flip);

      assert.instanceOf(error.reason, DecodeFailed);
    }),
  );
});
