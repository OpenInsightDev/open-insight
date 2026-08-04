import { Schema } from "effect";
import type * as Task from "#/task/index.ts";

const Cause = Schema.Error();

export class InitFailed extends Schema.TaggedErrorClass<InitFailed>(
  "open-insight/eval/BenchError/InitFailed",
)("InitFailed", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize benchmark: ${this.cause.message}`;
  }
}

export class TaskLoadFailed extends Schema.TaggedErrorClass<TaskLoadFailed>(
  "open-insight/eval/BenchError/TaskLoadFailed",
)("TaskLoadFailed", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to load benchmark task: ${this.cause.message}`;
  }
}

export class TaskNotFound extends Schema.TaggedErrorClass<TaskNotFound>(
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

export class BenchError extends Schema.TaggedErrorClass<BenchError>("open-insight/eval/BenchError")(
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
    BenchError.make({ reason: InitFailed.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }) });

  static taskLoad = (cause: unknown): BenchError =>
    BenchError.make({
      reason: TaskLoadFailed.make({ cause: Schema.decodeUnknownSync(Cause)(cause) }),
    });

  static taskNotFound = (id: Task.ID): BenchError =>
    BenchError.make({ reason: TaskNotFound.make({ id }) });
}
