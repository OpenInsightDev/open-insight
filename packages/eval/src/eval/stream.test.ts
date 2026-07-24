import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema, Stream } from "effect";
import { Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import { transformPrompt } from "./stream.ts";

const TestTool = Tool.make("TestTool", {
  parameters: Schema.Struct({ input: Schema.String }),
  success: Schema.Struct({ output: Schema.String }),
});

const TestToolkit = Toolkit.make(TestTool);
type TestTools = Toolkit.Tools<typeof TestToolkit>;

const collect = <E, R>(
  stream: Stream.Stream<Response.StreamPart<TestTools>, E, R>,
): Effect.Effect<Array<Prompt.Part>, E, R> => stream.pipe(transformPrompt, Stream.runCollect);

describe("streamPartsToPromptParts", () => {
  it.effect("emits completed text and reasoning parts", () =>
    Effect.gen(function* () {
      const parts = yield* collect(
        Stream.make(
          Response.makePart("text-start", { id: "text-1" }),
          Response.makePart("reasoning-start", { id: "reasoning-1" }),
          Response.makePart("text-delta", { id: "text-1", delta: "Hello" }),
          Response.makePart("reasoning-delta", { id: "reasoning-1", delta: "Think" }),
          Response.makePart("text-delta", { id: "text-1", delta: " world" }),
          Response.makePart("text-end", { id: "text-1" }),
          Response.makePart("reasoning-delta", { id: "reasoning-1", delta: "ing" }),
          Response.makePart("reasoning-end", { id: "reasoning-1" }),
        ),
      );

      assert.deepStrictEqual(parts, [
        Prompt.textPart({ text: "Hello world" }),
        Prompt.reasoningPart({ text: "Thinking" }),
      ]);
    }),
  );

  it.effect("converts tool parts and skips preliminary results and metadata", () =>
    Effect.gen(function* () {
      const parts = yield* collect(
        Stream.make(
          Response.makePart("response-metadata", {
            id: "response-1",
            modelId: "model-1",
            timestamp: undefined,
            request: undefined,
          }),
          Response.makePart("tool-params-start", {
            id: "call-1",
            name: "TestTool",
            providerExecuted: false,
          }),
          Response.makePart("tool-params-delta", { id: "call-1", delta: '{"input":"x"}' }),
          Response.makePart("tool-params-end", { id: "call-1" }),
          Response.toolCallPart({
            id: "call-1",
            name: "TestTool",
            params: { input: "x" },
            providerExecuted: false,
          }),
          Response.toolResultPart({
            id: "call-1",
            name: "TestTool",
            isFailure: false,
            result: { output: "pending" },
            encodedResult: { output: "pending" },
            preliminary: true,
            providerExecuted: false,
          }),
          Response.toolResultPart({
            id: "call-1",
            name: "TestTool",
            isFailure: false,
            result: { output: "done" },
            encodedResult: { output: "done" },
            preliminary: false,
            providerExecuted: false,
          }),
          Response.toolApprovalRequestPart({
            approvalId: "approval-1",
            toolCallId: "call-1",
          }),
        ),
      );

      assert.deepStrictEqual(parts, [
        Prompt.toolCallPart({
          id: "call-1",
          name: "TestTool",
          params: { input: "x" },
          providerExecuted: false,
        }),
        Prompt.toolResultPart({
          id: "call-1",
          name: "TestTool",
          isFailure: false,
          result: { output: "done" },
        }),
        Prompt.toolApprovalRequestPart({
          approvalId: "approval-1",
          toolCallId: "call-1",
        }),
      ]);
    }),
  );

  it.effect("does not emit unfinished parts when the stream ends", () =>
    Effect.gen(function* () {
      const parts = yield* collect(
        Stream.make(
          Response.makePart("text-start", { id: "text-1" }),
          Response.makePart("text-delta", { id: "text-1", delta: "unfinished" }),
        ),
      );

      assert.deepStrictEqual(parts, []);
    }),
  );

  it.effect("preserves stream failures", () =>
    Effect.gen(function* () {
      const error = new Error("stream failed");
      const stream: Stream.Stream<Response.StreamPart<TestTools>, Error> = Stream.make(
        Response.makePart("text-start", { id: "text-1" }),
        Response.makePart("text-delta", { id: "text-1", delta: "unfinished" }),
      ).pipe(Stream.concat(Stream.fail(error)));

      const failure = yield* stream.pipe(transformPrompt, Stream.runCollect, Effect.flip);

      assert.strictEqual(failure, error);
    }),
  );
});
