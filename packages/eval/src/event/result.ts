import * as Bench from "#/bench/index.ts";
import { Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";

export const SessionResult = Schema.TaggedStruct("SessionResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  usage: Schema.NullOr(Response.Usage),
  trajectory: Prompt.Trajectory,
});
export type SessionResult = Schema.Schema.Type<typeof SessionResult>;

export const TrailResult = Schema.TaggedStruct("TrailResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  grade: Schema.Unknown,
  sessions: Schema.Array(SessionResult),
});
export type TrailResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  grade: G;
  sessions: ReadonlyArray<SessionResult>;
}>;

export const TaskResult = Schema.TaggedStruct("TaskResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.TaggedStruct("BenchResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G = unknown> = Readonly<{
  startedAt: Timestamp;
  finishedAt: Timestamp;
  tasks: Record<string, TaskResult<G>>;
}>;

export const Result = Schema.Struct({
  startedAt: Timestamp,
  finishedAt: Timestamp,
  updatedAt: Timestamp,
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
