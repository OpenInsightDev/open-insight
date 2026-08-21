import { Prompt } from "@open-insight/core/internal";
import { Data } from "effect";
import { GradeError } from "./error.ts";

export type RetryType = "continue" | "restart";

export class Retry extends Data.TaggedError("Retry")<{
  readonly type: RetryType;
  readonly prompt: Prompt.Prompt;
  readonly reason: string | null;
}> {}

export const retry = ({
  type,
  prompt,
  reason,
}: {
  type: RetryType;
  prompt: Prompt.Prompt;
  reason?: string | null;
}) => new Retry({ type, prompt, reason: reason ?? null });

export const mapError = (cause: unknown) =>
  cause instanceof Retry ? cause : GradeError.exec(cause);
