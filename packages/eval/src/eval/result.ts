import * as Bench from "#/bench/index.ts";
import { TimestampSchema, type Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";

export const StageTrajectories = Schema.Record(Schema.String, Prompt.Trajectory);
export type StageTrajectories = Schema.Schema.Type<typeof StageTrajectories>;

export const TrailResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  usage: Schema.NullOr(Response.Usage),
  grade: Schema.Unknown,
  trajectories: StageTrajectories,
});
export type TrailResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  usage: Response.Usage | null;
  trajectories: StageTrajectories;
  grade: G;
}>;

export const TaskResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  tasks: Record<string, TaskResult<G>>;
}>;

export const Result = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  benchMetadata: Bench.Metadata,
  result: BenchResult,
});
export type Result<G = unknown> = Readonly<{
  startedAt: Timestamp;
  updatedAt: Timestamp;
  finishedAt: Timestamp;
  benchMetadata: Bench.Metadata;
  result: BenchResult<G>;
}>;

// TODO accumulate event stream into Result
