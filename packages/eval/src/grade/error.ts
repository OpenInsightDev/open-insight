import { Schema } from "effect";

export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  cause: Schema.Defect(),
}) {}

export class InvalidResultError extends Schema.TaggedErrorClass<InvalidResultError>()(
  "InvalidResultError",
  {
    cause: Schema.Defect(),
  },
) {}

export const ErrorReason = Schema.Union([ExecError, InvalidResultError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("GradeError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static exec = this.mapUnknownError((cause) => new ExecError({ cause }));

  static result = this.mapUnknownError((cause) => new InvalidResultError({ cause }));
}
