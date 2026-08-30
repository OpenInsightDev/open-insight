import { Prompt } from "effect/unstable/ai";
import { Data, Effect, Option } from "effect";
import { PromptError } from "./error.ts";
import * as Sandox from "#/sandbox/index.ts";

export class Turns extends Data.TaggedClass("Turns")<{
  init: Prompt.Prompt;
  next: (
    response: Prompt.Prompt,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, PromptError, Sandox.Current>;
}> {}

export const makeTurns = Effect.fn(function* <E, R>(
  init: Prompt.RawInput,
  next?: (
    trajectory: Prompt.Prompt,
  ) => Effect.Effect<Prompt.RawInput | null, E, R | Sandox.Current>,
) {
  const ctx = yield* Effect.context<R>();

  return new Turns({
    init: Prompt.make(init),
    next: Effect.fn(function* (response) {
      const nextPrompt = next?.(response) ?? Effect.succeed(null);
      return yield* nextPrompt.pipe(
        Effect.mapError(PromptError.generate),
        Effect.map(Option.fromNullOr),
        Effect.map(Option.map(Prompt.make)),
      );
    }, Effect.provide(ctx)),
  });
});
