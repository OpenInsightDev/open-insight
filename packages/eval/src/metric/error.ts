import { Schema } from "effect";

export class ExecError extends Schema.TaggedErrorClass<ExecError>()("ExecError", {
  name: Schema.String,
  type: Schema.Union([
    Schema.Literal("Trajectory"),
    Schema.Literal("Task"),
    Schema.Literal("Bench"),
  ]),
  cause: Schema.Defect(),
}) {}

export const ErrorReason = Schema.Union([ExecError]);
export type ErrorReason = Schema.Schema.Type<typeof ErrorReason>;

export class Error extends Schema.TaggedErrorClass<Error>()("MetricError", {
  reason: ErrorReason,
}) {
  static mapUnknownError = (mapper: (cause: unknown) => ErrorReason) => (cause: unknown) =>
    cause instanceof Error ? cause : new Error({ reason: mapper(cause) });

  static exec = ({ name, type }: { name: string; type: "Trajectory" | "Task" | "Bench" }) =>
    Error.mapUnknownError((cause) => new ExecError({ name, type, cause }));

  static taskExec = (name: string) => Error.exec({ name, type: "Task" });
  static trajExec = (name: string) => Error.exec({ name, type: "Trajectory" });
  static benchExec = (name: string) => Error.exec({ name, type: "Bench" });
}
