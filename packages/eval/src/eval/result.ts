import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";

export const TrailResult = Schema.Struct({
  grade: Schema.Record(Schema.String, Schema.Json),
  trajectory: Prompt.Trajectory,
});
export type TrailResult<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

export const TaskResult = Schema.Struct({
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G extends Grade.Result = Grade.Result> = Readonly<{
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.Struct({
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G extends Grade.Result = Grade.Result> = Readonly<{
  tasks: Record<string, TaskResult<G>>;
}>;

export const Result = Schema.Struct({
  result: BenchResult,
  events: Schema.Array(Event.Event),
});
export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  result: BenchResult<G>;
  events: ReadonlyArray<Event.Event>;
}>;
