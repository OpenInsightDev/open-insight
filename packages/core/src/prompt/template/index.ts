import { Eta } from "eta";
import { Effect, FileSystem } from "effect";
import { Prompt } from "effect/unstable/ai";
import { PromptError } from "../error.ts";

const eta = new Eta();

export const fromEta = Effect.fn("Prompt.fromEta")(function* (
  filePath: string,
  data: object = {},
): Effect.fn.Return<Prompt.UserMessage, PromptError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const template = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError(PromptError.template(filePath)));
  const text = yield* Effect.try(() => eta.renderString(template, data)).pipe(
    Effect.mapError(PromptError.template(filePath)),
  );

  return Prompt.userMessage({ content: [Prompt.textPart({ text })] });
});
