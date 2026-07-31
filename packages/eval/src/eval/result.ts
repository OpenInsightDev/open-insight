import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { TimestampSchema, type Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";

export const TrailResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  usage: Schema.NullOr(Response.Usage),
  grade: Grade.Result,
  trajectory: Prompt.Trajectory,
});
export type TrailResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  usage: Response.Usage | null;
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

export const TaskResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  tasks: Record<string, TaskResult<G>>;
}>;

export const Result = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  benchMetadata: Bench.Metadata,
  harnessMetadata: Harness.Metadata,
  result: BenchResult,
  events: Schema.Array(Event.Event),
});
export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt: Timestamp;
  benchMetadata: Bench.Metadata;
  harnessMetadata: Harness.Metadata;
  result: BenchResult<G>;
  events: ReadonlyArray<Event.Event>;
}>;
