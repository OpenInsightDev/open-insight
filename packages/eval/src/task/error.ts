import { Formatter, Schema } from "effect";

/** A task result could not be calculated. */
export class ResultFailed extends Schema.TaggedError<ResultFailed>(
  "open-insight/eval/TaskError/ResultFailed",
)("ResultFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Task result calculation failed: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([ResultFailed]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by task operations. */
export class TaskError extends Schema.TaggedError<TaskError>("open-insight/eval/TaskError")(
  "TaskError",
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

  static result = (cause: unknown): TaskError =>
    TaskError.make({ reason: ResultFailed.make({ cause }) });
}
