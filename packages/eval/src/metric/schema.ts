import type { Agent } from "@open-insight/core/internal";
import * as Task from "../task/index.ts";
import { Data, Schema } from "effect";

export const GradeResultSchema = Task.Grade.ResultSchema;
export type GradeResult = Schema.Schema.Type<typeof GradeResultSchema>;

export type InputDelta = Data.TaggedEnum<{
  Messages: { messages: Array<Agent.Message> };
  Grade: { result: GradeResult };
}>;
export const { Grade, Messages } = Data.taggedEnum<InputDelta>();

export type Input = Readonly<{
  task: Task.Task;
  trailIndex: number;
  trajectory: Agent.Trajectory;
  delta: InputDelta;
}>;

export class TrajOutput extends Schema.TaggedClass<TrajOutput>()("TrajOutput", {
  name: Schema.String,
  task: Task.Metadata,
  trailIndex: Schema.Number,
  result: Schema.Json,
}) {}

export class TaskOutput extends Schema.TaggedClass<TaskOutput>()("TaskOutput", {
  name: Schema.String,
  task: Task.Metadata,
  result: Schema.Json,
}) {}

export class BenchOutput extends Schema.TaggedClass<BenchOutput>()("BenchmarkOutput", {
  name: Schema.String,
  result: Schema.Json,
}) {}

export const OutputSchema = Schema.Union([TrajOutput, TaskOutput, BenchOutput]);
export type Output = Schema.Schema.Type<typeof OutputSchema>;

export const TypeSchema = Schema.Union([
  Schema.Literal("Trajectory"),
  Schema.Literal("Task"),
  Schema.Literal("Benchmark"),
]);
export type Type = Schema.Schema.Type<typeof TypeSchema>;

export const VariantSchema = Schema.Union([
  Schema.Literal("Reduce"),
  Schema.Literal("Each"),
  Schema.Literal("All"),
]);
export type Variant = Schema.Schema.Type<typeof VariantSchema>;

export class Metadata extends Schema.Class<Metadata>("Metadata")({
  name: Schema.String,
  type: TypeSchema,
  variant: VariantSchema,
}) {}
