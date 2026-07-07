import { Schema } from "effect";

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>()("TaskLoadError", {
  cause: Schema.Defect(),
}) {}

export class GradeExecError extends Schema.TaggedErrorClass<GradeExecError>()("GradeError", {
  cause: Schema.Defect(),
}) {}

export class InvalidGradeResultError extends Schema.TaggedErrorClass<InvalidGradeResultError>()(
  "InvalidGradeResultError",
  {
    cause: Schema.Defect(),
  },
) {}

export const TaskErrorReason = Schema.Union([
  TaskLoadError,
  GradeExecError,
  InvalidGradeResultError,
]);
export type TaskErrorReason = Schema.Schema.Type<typeof TaskErrorReason>;

export class TaskError extends Schema.TaggedErrorClass<TaskError>()("TaskError", {
  reason: TaskErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => TaskErrorReason) => (cause: unknown) =>
    cause instanceof TaskError ? cause : new TaskError({ reason: mapper(cause) });

  static load = this.mapUnknownError((cause) => new TaskLoadError({ cause }));

  static gradeExec = this.mapUnknownError((cause) => new GradeExecError({ cause }));

  static gradeResult = this.mapUnknownError((cause) => new InvalidGradeResultError({ cause }));
}
