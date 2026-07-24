import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";

export class TrailResult extends Schema.Class<TrailResult>("TrailResult")({
  grade: Schema.Record(Schema.String, Schema.Json),
  trajectory: Prompt.Trajectory,
}) {}

export class TaskResult extends Schema.Class<TaskResult>("TaskResult")({
  trails: Schema.Array(TrailResult),
}) {}

export class Result extends Schema.Class<Result>("ExecResult")({
  tasks: Schema.Record(Schema.String, TaskResult),
}) {}
