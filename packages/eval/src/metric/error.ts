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

export const MetricErrorReason = Schema.Union([ExecError]);

export class MetricError extends Schema.TaggedErrorClass<MetricError>()("MetricError", {
  reason: MetricErrorReason,
}) {
  static exec =
    ({ name, type }: { name: string; type: "Trajectory" | "Task" | "Bench" }) =>
    (cause: unknown) =>
      new MetricError({
        reason: new ExecError({ name, type, cause }),
      });

  static taskExec = (name: string) => MetricError.exec({ name, type: "Task" });
  static trajExec = (name: string) => MetricError.exec({ name, type: "Trajectory" });
  static benchExec = (name: string) => MetricError.exec({ name, type: "Bench" });
}
