import { Schema } from "effect";

export class TaskLoadError extends Schema.TaggedErrorClass<TaskLoadError>()("TaskLoadError", {
  cause: Schema.Defect(),
}) {}

export class GradeExecError extends Schema.TaggedErrorClass<GradeExecError>()("GradeError", {
  name: Schema.String,
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

export class TaskError extends Schema.TaggedErrorClass<TaskError>()("TaskError", {
  reason: TaskErrorReason,
}) {
  static load = (cause: unknown) =>
    new TaskError({
      reason: new TaskLoadError({ cause }),
    });

  static gradeExec = (name: string) => (cause: unknown) =>
    new TaskError({
      reason: new GradeExecError({ name, cause }),
    });

  static gradeResult = (cause: Schema.SchemaError) =>
    new TaskError({
      reason: new InvalidGradeResultError({ cause }),
    });
}
