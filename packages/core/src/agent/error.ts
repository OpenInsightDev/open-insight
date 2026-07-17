import { Schema } from "effect";

export class StreamError extends Schema.TaggedErrorClass<StreamError>()("StreamError", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([StreamError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("AgentError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static stream = this.mapUnknownError((cause) => new StreamError({ cause }));
}
