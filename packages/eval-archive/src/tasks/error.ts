import { Formatter, Schema } from "effect";

/** A task source could not be accessed or prepared. */
export class SourceNotAvailable extends Schema.TaggedError<SourceNotAvailable>(
  "open-insight/TasksError/SourceNotAvailable",
)("SourceNotAvailable", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to access task source: ${Formatter.format(this.cause)}`;
  }
}

/** A resolved value could not be interpreted as a valid task. */
export class InvalidTask extends Schema.TaggedError<InvalidTask>(
  "open-insight/TasksError/InvalidTask",
)("InvalidTask", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Invalid task: ${Formatter.format(this.cause)}`;
  }
}

/** A valid task requires capabilities that are not supported. */
export class UnsupportedTask extends Schema.TaggedError<UnsupportedTask>(
  "open-insight/TasksError/UnsupportedTask",
)("UnsupportedTask", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Unsupported task: ${Formatter.format(this.cause)}`;
  }
}

/** A task could not be constructed or initialized. */
export class InitFailed extends Schema.TaggedError<InitFailed>(
  "open-insight/TasksError/InitFailed",
)("InitFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to initialize task collection: ${Formatter.format(this.cause)}`;
  }
}

/** An explicit task source directory exists but cannot be reused safely. */
export class DirectoryConflict extends Schema.TaggedError<DirectoryConflict>(
  "open-insight/TasksError/DirectoryConflict",
)("DirectoryConflict", {
  directory: Schema.String,
}) {
  override get message(): string {
    return `Refusing to modify existing task source directory: ${this.directory}`;
  }
}

export const ErrorReason = Schema.Union([
  SourceNotAvailable,
  InvalidTask,
  UnsupportedTask,
  InitFailed,
  DirectoryConflict,
]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

/** The normalized error exposed by task collection operations. */
export class TasksError extends Schema.TaggedError<TasksError>("open-insight/TasksError")(
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
      reason: SourceNotAvailable.make({ cause }),
    });

  static invalid = (cause: unknown): TasksError =>
    TasksError.make({
      reason: InvalidTask.make({ cause }),
    });

  static unsupported = (cause: unknown): TasksError =>
    TasksError.make({
      reason: UnsupportedTask.make({ cause }),
    });

  static init = (cause: unknown): TasksError =>
    TasksError.make({
      reason: InitFailed.make({ cause }),
    });

  static directoryConflict = (directory: string): TasksError =>
    TasksError.make({
      reason: DirectoryConflict.make({ directory }),
    });
}
