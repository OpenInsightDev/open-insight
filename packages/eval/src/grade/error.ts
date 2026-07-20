import { Prompt } from "@open-insight/core";
import { Schema } from "effect";

export class Retry extends Schema.TaggedErrorClass<Retry>()("Retry", {
  prompt: Prompt.UserMessage,
}) {}

export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  cause: Schema.Defect(),
}) {}

export class VerifyError extends Schema.TaggedErrorClass<VerifyError>()("VerifyError", {
  cause: Schema.Defect(),
}) {}

export class InvalidResultError extends Schema.TaggedErrorClass<InvalidResultError>()(
  "InvalidResultError",
  {
    cause: Schema.Defect(),
  },
) {}

export const ErrorReason = Schema.Union([Retry, ExecError, VerifyError, InvalidResultError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("GradeError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static exec = this.mapUnknownError((cause) => new ExecError({ cause }));

  static verify = this.mapUnknownError((cause) => new VerifyError({ cause }));

  static result = this.mapUnknownError((cause) => new InvalidResultError({ cause }));

  static retry = (prompt: Prompt.UserMessage) => new Error({ reason: new Retry({ prompt }) });
}
