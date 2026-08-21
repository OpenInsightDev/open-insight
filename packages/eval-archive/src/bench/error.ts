import { Formatter, Schema } from "effect";
import type * as Task from "#/task/index.ts";

export class InitFailed extends Schema.TaggedError<InitFailed>(
  "open-insight/eval/BenchError/InitFailed",
)("InitFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to initialize benchmark: ${Formatter.format(this.cause)}`;
  }
}

export class TaskLoadFailed extends Schema.TaggedError<TaskLoadFailed>(
  "open-insight/eval/BenchError/TaskLoadFailed",
)("TaskLoadFailed", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to load benchmark task: ${Formatter.format(this.cause)}`;
  }
}

export class TaskNotFound extends Schema.TaggedError<TaskNotFound>(
  "open-insight/eval/BenchError/TaskNotFound",
)("TaskNotFound", {
  id: Schema.String,
}) {
  override get message(): string {
    return `Benchmark task "${this.id}" was not found`;
  }
}

export const ErrorReason = Schema.Union([InitFailed, TaskLoadFailed, TaskNotFound]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class BenchError extends Schema.TaggedError<BenchError>("open-insight/eval/BenchError")(
  "BenchError",
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

  static init = (cause: unknown): BenchError =>
    BenchError.make({ reason: InitFailed.make({ cause }) });

  static taskLoad = (cause: unknown): BenchError =>
    BenchError.make({
      reason: TaskLoadFailed.make({ cause }),
    });

  static taskNotFound = (id: Task.ID): BenchError =>
    BenchError.make({ reason: TaskNotFound.make({ id }) });
}
