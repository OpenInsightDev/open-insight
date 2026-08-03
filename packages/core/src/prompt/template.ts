import { Eta } from "eta";
import { Effect, FileSystem } from "effect";
import { Prompt } from "effect/unstable/ai";

const eta = new Eta();

/** Loads an Eta template from disk and creates a text user message from it. */
export const fromEta = Effect.fn("Prompt.fromEta")(function* (filePath: string, data: object = {}) {
  const fs = yield* FileSystem.FileSystem;
  const template = yield* fs.readFileString(filePath);
  const text = yield* Effect.try(() => eta.renderString(template, data));

  return Prompt.userMessage({ content: [Prompt.textPart({ text })] });
});
