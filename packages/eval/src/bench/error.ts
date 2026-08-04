import { Schema } from "effect";
import type * as Task from "#/task/index.ts";

const Cause = Schema.Error();

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to initialize benchmark: ${this.cause.message}`;
  }
}

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>()("TaskLoadError", {
  cause: Cause,
}) {
  override get message(): string {
    return `Failed to load benchmark task: ${this.cause.message}`;
  }
}

export class TaskNotFound extends Schema.TaggedErrorClass<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {
  override get message(): string {
    return `Benchmark task "${this.id}" was not found`;
  }
}

export const ErrorReason = Schema.Union([InitError, TaskLoadError, TaskNotFound]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("BenchError", {
  reason: ErrorReason,
}) {
  override get message(): string {
    return this.reason.message;
  }

  override get cause(): ErrorReason {
    return this.reason;
  }

  static mapUnknownError = (mapper: (cause: globalThis.Error) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error
      ? cause
      : new Error({ reason: mapper(Schema.decodeUnknownSync(Cause)(cause)) });

  static init = this.mapUnknownError((cause) => new InitError({ cause }));

  static taskLoad = this.mapUnknownError((cause) => new TaskLoadError({ cause }));

  static taskNotFound = (id: Task.ID) => new Error({ reason: new TaskNotFound({ id }) });
}
