import { Schema } from "effect";
import type * as Task from "#/task/index.ts";

const Cause = Schema.Error();

export class InitError extends Schema.TaggedErrorClass<InitError>(
  "open-insight/eval/BenchError/InitError",
)("InitError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize benchmark: ${this.cause.message}`;
  }
}

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>(
  "open-insight/eval/BenchError/TaskLoadError",
)("TaskLoadError", {
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

export const ErrorReason = Schema.Union([InitError, TaskLoadError, TaskNotFound]);
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

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    BenchError.make({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

  static init = this.mapUnknownError((cause) => InitError.make({ cause }));

  static taskLoad = this.mapUnknownError((cause) => TaskLoadError.make({ cause }));

  static taskNotFound = (id: Task.ID) => BenchError.make({ reason: TaskNotFound.make({ id }) });
}
