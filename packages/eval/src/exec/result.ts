import { Agent } from "@open-insight/core/internal";
import { Schema } from "effect";

export class TrailResult extends Schema.Class<TrailResult>("TrailResult")({
  grades: Schema.Record(Schema.String, Schema.Json),
  metrics: Schema.Record(Schema.String, Schema.Json),
  trajectory: Agent.Trajectory,
}) {}

export class TaskResult extends Schema.Class<TaskResult>("TaskResult")({
  metrics: Schema.Record(Schema.String, Schema.Json),
  trails: Schema.Array(TrailResult),
}) {}

export class ExecResult extends Schema.Class<ExecResult>("ExecResult")({
  metrics: Schema.Record(Schema.String, Schema.Json),
  tasks: Schema.Record(Schema.String, TaskResult),
}) {}
