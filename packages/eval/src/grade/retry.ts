import { Prompt } from "@open-insight/core/internal";
import { Data } from "effect";

export class Resume extends Data.TaggedError("Continue")<{
  readonly prompt: Prompt.RawInput;
}> {}
export const resume = (prompt: Prompt.RawInput) => new Resume({ prompt });

export class Restart extends Data.TaggedError("Restart")<{
  readonly prompt: Prompt.RawInput;
  reason?: string;
}> {}
export const restart = (prompt: Prompt.RawInput, reason?: string) =>
  new Restart({ prompt, reason });
