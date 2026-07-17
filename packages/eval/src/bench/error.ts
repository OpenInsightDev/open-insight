import { Schema } from "effect";

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([InitError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("BenchError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static init = this.mapUnknownError((cause) => new InitError({ cause }));
}
