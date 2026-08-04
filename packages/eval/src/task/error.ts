import { Formatter, Schema } from "effect";

export class PromptError extends Schema.TaggedErrorClass<PromptError>(
  "open-insight/TaskError/PromptError",
)("PromptError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Task prompt failed: ${Formatter.format(this.cause)}`;
  }
}

export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>(
  "open-insight/TaskError/InvalidMetadata",
)("InvalidMetadata", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid task metadata: ${Formatter.format(this.cause)}`;
  }
}

export const ErrorReason = Schema.Union([PromptError, InvalidMetadata]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class TaskError extends Schema.TaggedErrorClass<TaskError>("open-insight/TaskError")(
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

  static prompt = (cause: unknown): TaskError =>
    TaskError.make({ reason: PromptError.make({ cause }) });

  static metadata = (cause: unknown): TaskError =>
    TaskError.make({ reason: InvalidMetadata.make({ cause }) });
}
