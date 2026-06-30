import * as Task from "../task/index.ts";
import { Schema } from "effect";
import * as Metric from "@/metric/index.ts";

export const TaskResultSchema = Schema.Struct({
  metrics: Schema.Array(Metric.TaskOutput),
  trails: Schema.Array(Task.Grade.ResultSchema),
});
export type TaskResult = Schema.Schema.Type<typeof TaskResultSchema>;

export const ExecResultSchema = Schema.Struct({
  metrics: Schema.Array(Metric.BenchOutput),
  tasks: Schema.Record(Schema.String, TaskResultSchema),
});
export type ExecResult = Schema.Schema.Type<typeof ExecResultSchema>;
