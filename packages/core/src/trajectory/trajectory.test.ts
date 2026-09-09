import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { Prompt, Response, Toolkit } from "effect/unstable/ai";
import { fromPrompt } from "./trajectory.ts";

const collect = <A, E>(stream: Stream.Stream<A, E>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  );

describe("Trajectory.fromPrompt", () => {
  it.effect("groups prompt messages and assistant responses into turns", () =>
    Effect.gen(function* () {
      const system = Prompt.systemMessage({ content: "You are helpful." });
      const firstUser = Prompt.userMessage({ content: [Prompt.textPart({ text: "Hello" })] });
      const firstAssistant = Prompt.assistantMessage({
        content: [Prompt.textPart({ text: "Hi there" })],
      });
      const tool = Prompt.toolMessage({
        content: [
          Prompt.toolResultPart({
            id: "call-1",
            name: "lookup",
            isFailure: false,
            result: "done",
            providerExecuted: false,
          }),
        ],
      });
      const secondAssistant = Prompt.assistantMessage({
        content: [Prompt.reasoningPart({ text: "The result is complete." })],
      });

      const trajectory = yield* fromPrompt(
        Prompt.fromMessages([system, firstUser, firstAssistant, tool, secondAssistant]),
      );
      const turns = yield* collect(trajectory);

      assert.strictEqual(trajectory.toolkit, Toolkit.empty);
      assert.lengthOf(turns, 2);
      assert.deepStrictEqual(turns[0]?.prompt.messages, [system, firstUser]);
      assert.deepStrictEqual(
        (yield* collect(turns[0]!.response)).map((part) => part.response),
        [Response.makePart("text", { text: "Hi there" })],
      );
      assert.deepStrictEqual(turns[1]?.prompt.messages, [tool]);
      assert.deepStrictEqual(
        (yield* collect(turns[1]!.response)).map((part) => part.response),
        [Response.makePart("reasoning", { text: "The result is complete." })],
      );
    }),
  );

  it.effect("preserves prompts with empty responses", () =>
    Effect.gen(function* () {
      const user = Prompt.userMessage({ content: [Prompt.textPart({ text: "No answer yet" })] });
      const turns = yield* collect(yield* fromPrompt(Prompt.fromMessages([user])));

      assert.lengthOf(turns, 1);
      assert.deepStrictEqual(turns[0]?.prompt.messages, [user]);
      assert.deepStrictEqual(yield* collect(turns[0]!.response), []);
    }),
  );

  it.effect("keeps leading assistant output and converts response metadata", () =>
    Effect.gen(function* () {
      const options = { provider: { traceId: "trace-1" } };
      const assistant = Prompt.assistantMessage({
        content: [
          Prompt.toolApprovalRequestPart({
            approvalId: "approval-1",
            toolCallId: "call-1",
            options,
          }),
          Prompt.filePart({
            mediaType: "text/plain",
            data: "aGk=",
          }),
        ],
      });

      const turns = yield* collect(yield* fromPrompt(Prompt.fromMessages([assistant])));
      const responses = yield* collect(turns[0]!.response);

      assert.lengthOf(turns, 1);
      assert.deepStrictEqual(turns[0]?.prompt.messages, []);
      assert.deepStrictEqual(
        responses[0]?.response,
        Response.makePart("tool-approval-request", {
          approvalId: "approval-1",
          toolCallId: "call-1",
          metadata: options,
        }),
      );
      assert.deepStrictEqual(
        responses[1]?.response,
        Response.makePart("file", {
          mediaType: "text/plain",
          data: new Uint8Array([104, 105]),
        }),
      );
    }),
  );
});
