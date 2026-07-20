import { Schema } from "effect";

export class PromptError extends Schema.TaggedErrorClass<PromptError>()("PromptError", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([PromptError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("TaskError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static prompt = this.mapUnknownError((cause) => new PromptError({ cause }));
}
