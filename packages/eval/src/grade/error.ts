import { Sandbox } from "@open-insight/core/internal";
import { Formatter, Schema } from "effect";

/** The grader execution failed. */
export class ExecutionFailed extends Schema.TaggedError<ExecutionFailed>(
  "open-insight/eval/GradeError/ExecutionFailed",
)("ExecutionFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Grader execution failed: ${Formatter.format(this.cause)}`;
  }
}

/** The grader verification run failed. */
export class VerificationFailed extends Schema.TaggedError<VerificationFailed>(
  "open-insight/eval/GradeError/VerificationFailed",
)("VerificationFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Grader verification failed: ${Formatter.format(this.cause)}`;
  }
}

/** The grader produced a result that does not satisfy its declared schema. */
export class InvalidResult extends Schema.TaggedError<InvalidResult>(
  "open-insight/eval/GradeError/InvalidResult",
)("InvalidResult", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid grader result: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([
  ExecutionFailed,
  VerificationFailed,
  InvalidResult,
  Sandbox.SandboxError,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by grader execution. */
export class GradeError extends Schema.TaggedError<GradeError>("open-insight/eval/GradeError")(
  "GradeError",
  {
    reason: ErrorReason,
  },
) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static exec = (cause: unknown): GradeError =>
    GradeError.make({ reason: ExecutionFailed.make({ cause }) });

  static verify = (cause: unknown): GradeError =>
    GradeError.make({ reason: VerificationFailed.make({ cause }) });

  static result = (cause: unknown): GradeError =>
    GradeError.make({ reason: InvalidResult.make({ cause }) });

  static sandbox = (cause: Sandbox.SandboxError): GradeError => GradeError.make({ reason: cause });
}
