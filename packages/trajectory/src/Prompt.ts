/**
 * Prompts sent to a model, re-exported from `effect/ai`.
 *
 * A session drives a conversation one prompt at a time, advancing the prompt
 * with a step that may inspect the sandbox.
 */
import { Effect, Option } from "effect";
import { Prompt } from "effect/ai";
import type { Sandbox } from "@open-insight/sandbox";

export type Session<E = never> = Readonly<{
  init: Prompt.Prompt;
  next: (
    prompt: Prompt.Prompt,
    sandbox: Sandbox.Sandbox,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, E>;
}>;

export type SessionOptions<E = never> = Readonly<{
  init: Prompt.RawInput;
  next?: (
    prompt: Prompt.Prompt,
    sandbox: Sandbox.Sandbox,
  ) => Effect.Effect<Prompt.RawInput | null, E>;
}>;

export const makeSession = <E>({ init, next }: SessionOptions<E>): Session<E> => ({
  init: Prompt.make(init),
  next: Effect.fn(function* (prompt, sandbox) {
    const nextPrompt = next?.(prompt, sandbox) ?? Effect.succeed(null);
    return yield* nextPrompt.pipe(
      Effect.map(Option.fromNullOr),
      Effect.map(Option.map(Prompt.make)),
    );
  }),
});

export * from "effect/ai/Prompt";
