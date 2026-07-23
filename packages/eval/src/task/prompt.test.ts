import { assert, it } from "@effect/vitest";
import { Prompt as PromptModel } from "@open-insight/core/internal";
import { Effect } from "effect";
import { makePrompt, type PromptFnInput } from "./build.ts";

const userMessage = (text: string) =>
  PromptModel.userMessage({ content: [PromptModel.textPart({ text })] });

const firstMessage = userMessage("first");
const secondMessage = userMessage("second");
const emptyInput: PromptFnInput = {
  trajectory: PromptModel.empty,
  generated: [],
};

it.effect("returns a static trajectory once", () =>
  Effect.gen(function* () {
    const trajectory = PromptModel.make([firstMessage, secondMessage]);
    const prompt = yield* makePrompt(trajectory);

    assert.strictEqual(yield* prompt(emptyInput), trajectory);
    assert.strictEqual(yield* prompt(emptyInput), null);
  }),
);

it.effect("forwards each later session input to an async iterator", () =>
  Effect.gen(function* () {
    const inputs: Array<PromptFnInput> = [];
    const nextInput: PromptFnInput = {
      trajectory: PromptModel.make([firstMessage]),
      generated: [firstMessage],
    };

    async function* messages(): AsyncGenerator<
      PromptModel.UserMessage,
      void,
      PromptFnInput
    > {
      const input = yield firstMessage;
      inputs.push(input);
      yield secondMessage;
    }

    const prompt = yield* makePrompt(messages());
    const first = yield* prompt(emptyInput);
    const second = yield* prompt(nextInput);

    assert.strictEqual(first?.content[0], firstMessage);
    assert.strictEqual(second?.content[0], secondMessage);
    assert.deepStrictEqual(inputs, [nextInput]);
    assert.strictEqual(yield* prompt(nextInput), null);
  }),
);

it.effect("returns init before continuing with an async iterator", () =>
  Effect.gen(function* () {
    async function* messages(): AsyncGenerator<
      PromptModel.UserMessage,
      void,
      PromptFnInput
    > {
      yield secondMessage;
    }

    const prompt = yield* makePrompt({ init: firstMessage, then: messages() });
    const init = yield* prompt(emptyInput);
    const next = yield* prompt(emptyInput);

    assert.strictEqual(init?.content[0], firstMessage);
    assert.strictEqual(next?.content[0], secondMessage);
    assert.strictEqual(yield* prompt(emptyInput), null);
  }),
);
