import { Schema } from "effect";

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>()("TaskLoadError", {
  cause: Schema.Defect(),
}) {}

export const TaskErrorReason = Schema.Union([TaskLoadError]);
export type TaskErrorReason = Schema.Schema.Type<typeof TaskErrorReason>;

export class TaskError extends Schema.TaggedErrorClass<TaskError>()("TaskError", {
  reason: TaskErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => TaskErrorReason) => (cause: unknown) =>
    cause instanceof TaskError ? cause : new TaskError({ reason: mapper(cause) });

  static load = this.mapUnknownError((cause) => new TaskLoadError({ cause }));
}
