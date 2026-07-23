import { Schema } from "effect";
import type * as Task from "#/task/index.ts";

export class InitError extends Schema.TaggedErrorClass<InitError>()("InitError", {
  cause: Schema.Defect(),
}) {}

export class TaskNotFound extends Schema.TaggedErrorClass<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {}

export const ErrorReason = Schema.Union([InitError, TaskNotFound]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("BenchError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static init = this.mapUnknownError((cause) => new InitError({ cause }));

  static taskNotFound = (id: Task.ID) => new Error({ reason: new TaskNotFound({ id }) });
}
