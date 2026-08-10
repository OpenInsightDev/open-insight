import * as Bench from "#/bench/index.ts";
import { TimestampSchema, type Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";

export const StageResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  grade: Schema.Unknown,
  trajectory: Prompt.Trajectory,
  usage: Schema.NullOr(Response.Usage),
});
export type StageResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  grade: G;
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export const TrailResult = Schema.Struct({
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  grade: Schema.Unknown,
  stages: Schema.Array(StageResult),
});
export type TrailResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  grade: G;
  stages: ReadonlyArray<StageResult<G>>;
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
