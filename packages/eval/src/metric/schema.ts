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
  trajectory: Agent.Trajectory;
  delta: InputDelta;
}>;

export class TrajOutput extends Schema.TaggedClass<TrajOutput>()("TrajOutput", {
  name: Schema.String,
  task: Task.MetadataSchema,
  result: Schema.Json,
}) {}

export class TaskOutput extends Schema.TaggedClass<TaskOutput>()("TaskOutput", {
  name: Schema.String,
  task: Task.MetadataSchema,
  result: Schema.Json,
}) {}

export class BenchOutput extends Schema.TaggedClass<BenchOutput>()("BenchmarkOutput", {
  name: Schema.String,
  result: Schema.Json,
}) {}

export const OutputSchema = Schema.Union([TrajOutput, TaskOutput, BenchOutput]);
export type Output = Schema.Schema.Type<typeof OutputSchema>;
