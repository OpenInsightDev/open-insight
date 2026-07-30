import { Prompt } from "@open-insight/core";
import { Data, Schema } from "effect";

export class Retry extends Data.TaggedError("Retry")<{
  readonly prompt: Prompt.RawInput;
}> {}

export const retry = (prompt: Prompt.RawInput): Retry => new Retry({ prompt });

export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  cause: Schema.Defect(),
}) {}

export class VerifyError extends Schema.TaggedErrorClass<VerifyError>()("VerifyError", {
  cause: Schema.Defect(),
}) {}

export class InvalidResult extends Schema.TaggedErrorClass<InvalidResult>()("InvalidResult", {
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([ExecError, VerifyError, InvalidResult]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("GradeError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static exec = this.mapUnknownError((cause) => new ExecError({ cause }));

  static verify = this.mapUnknownError((cause) => new VerifyError({ cause }));

  static result = this.mapUnknownError((cause) => new InvalidResult({ cause }));
}
