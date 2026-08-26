import { Prompt } from "effect/unstable/ai";
import type { Trajectory } from "./traj.ts";
import { Data, Effect, Option } from "effect";
import { PromptError } from "./error.ts";
import * as Sandox from "#/sandbox/index.ts";

export class Turns extends Data.TaggedClass("Turns")<{
  init: Prompt.Prompt;
  next: (
    response: Trajectory,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, PromptError, Sandox.Current>;
}> {}

export const makeTurns = <E>(
  init: Prompt.RawInput,
  next?: (
    trajectory: Trajectory,
  ) => Effect.Effect<Option.Option<Prompt.RawInput>, E, Sandox.Current>,
) =>
  new Turns({
    init: Prompt.make(init),
    next: Effect.fn(function* (response) {
      const nextPrompt = next?.(response) ?? Effect.succeed(Option.none());
      return yield* nextPrompt.pipe(
        Effect.mapError(PromptError.generate),
        Effect.map(Option.map(Prompt.make)),
      );
    }),
  });
