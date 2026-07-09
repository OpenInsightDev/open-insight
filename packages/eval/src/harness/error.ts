import { Schema } from "effect";

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([InitError]);

export class Error extends Schema.TaggedErrorClass<Error>()("HarnessError", {
  reason: ErrorReason,
}) {
  static init = (cause: unknown) => new Error({ reason: new InitError({ cause }) });
}
