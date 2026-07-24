import { assert, describe, it } from "@effect/vitest";
import { Prompt } from "@open-insight/core/internal";
import { Effect } from "effect";
import { makePrompt, type PromptFactory, type PromptFnInput } from "./prompt.ts";

const userMessage = (text: string) => Prompt.userMessage({ content: [Prompt.textPart({ text })] });

describe("makePrompt", () => {
  it.effect("passes the initial input to the factory and later inputs to the iterator", () =>
    Effect.gen(function* () {
      const firstMessage = userMessage("first");
      const secondMessage = userMessage("second");
      const initialInput: PromptFnInput = {
        trajectory: Prompt.empty,
        generated: [],
      };
      const subsequentInput: PromptFnInput = {
        trajectory: Prompt.make([firstMessage]),
        generated: [firstMessage],
      };
      const received: Array<PromptFnInput> = [];
      const factory: PromptFactory = async function* (input) {
        received.push(input);
        const nextInput = yield firstMessage;
        received.push(nextInput);
        yield secondMessage;
      };

      const prompt = makePrompt({ followUp: factory });

      assert.deepStrictEqual(yield* prompt(initialInput), Prompt.make([firstMessage]));
      assert.deepStrictEqual(yield* prompt(subsequentInput), Prompt.make([secondMessage]));
      assert.isNull(yield* prompt(subsequentInput));
      assert.deepStrictEqual(received, [initialInput, subsequentInput]);
    }),
  );

  it.effect("derives messages from the full trajectory until the callback returns null", () =>
    Effect.gen(function* () {
      const message = userMessage("next");
      const trajectories: Array<Prompt.Trajectory> = [];
      const initialInput: PromptFnInput = {
        trajectory: Prompt.empty,
        generated: [],
      };
      const nextTrajectory = Prompt.make([message]);
      const subsequentInput: PromptFnInput = {
        trajectory: nextTrajectory,
        generated: [message],
      };
      const prompt = makePrompt(async (trajectory) => {
        trajectories.push(trajectory);
        return trajectories.length === 1 ? message : null;
      });

      assert.deepStrictEqual(yield* prompt(initialInput), Prompt.make([message]));
      assert.isNull(yield* prompt(subsequentInput));
      assert.deepStrictEqual(trajectories, [Prompt.empty, nextTrajectory]);
    }),
  );

  it.effect("creates the continuation only after returning init", () =>
    Effect.gen(function* () {
      const init = userMessage("init");
      const followUpMessage = userMessage("follow-up");
      const initialInput: PromptFnInput = {
        trajectory: Prompt.empty,
        generated: [],
      };
      const continuationInput: PromptFnInput = {
        trajectory: Prompt.make([init]),
        generated: [init],
      };
      const received: Array<PromptFnInput> = [];
      const followUp: PromptFactory = async function* (input) {
        received.push(input);
        yield followUpMessage;
      };

      const prompt = makePrompt({ init, followUp });

      assert.deepStrictEqual(yield* prompt(initialInput), Prompt.make([init]));
      assert.isEmpty(received);
      assert.deepStrictEqual(yield* prompt(continuationInput), Prompt.make([followUpMessage]));
      assert.deepStrictEqual(received, [continuationInput]);
    }),
  );
});
