import { Schema } from "effect";

const Cause = Schema.Error();

/** A task source could not be accessed or prepared. */
export class SourceNotAvailable extends Schema.TaggedErrorClass<SourceNotAvailable>(
  "open-insight/TasksError/SourceNotAvailable",
)("SourceNotAvailable", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to access task source: ${this.cause.message}`;
  }
}

/** A resolved value could not be interpreted as a valid task. */
export class InvalidTask extends Schema.TaggedErrorClass<InvalidTask>(
  "open-insight/TasksError/InvalidTask",
)("InvalidTask", {
  cause: Cause,
}) {
  override get message(): string {
    return `Invalid task: ${this.cause.message}`;
  }
}

/** A valid task requires capabilities that are not supported. */
export class UnsupportedTask extends Schema.TaggedErrorClass<UnsupportedTask>(
  "open-insight/TasksError/UnsupportedTask",
)("UnsupportedTask", {
  cause: Cause,
}) {
  override get message(): string {
    return `Unsupported task: ${this.cause.message}`;
  }
}

/** A task could not be constructed or initialized. */
export class InitFailed extends Schema.TaggedErrorClass<InitFailed>(
  "open-insight/TasksError/InitFailed",
)("InitFailed", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize task collection: ${this.cause.message}`;
  }
}

export const ErrorReason = Schema.Union([
  SourceNotAvailable,
  InvalidTask,
  UnsupportedTask,
  InitFailed,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by task collection operations. */
export class TasksError extends Schema.TaggedErrorClass<TasksError>("open-insight/TasksError")(
  "TasksError",
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

  static source = (cause: unknown): TasksError =>
    TasksError.make({
      reason: SourceNotAvailable.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });

  static invalid = (cause: unknown): TasksError =>
    TasksError.make({
      reason: InvalidTask.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });

  static unsupported = (cause: unknown): TasksError =>
    TasksError.make({
      reason: UnsupportedTask.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });

  static init = (cause: unknown): TasksError =>
    TasksError.make({
      reason: InitFailed.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });
}
