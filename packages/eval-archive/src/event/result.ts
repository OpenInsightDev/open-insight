import { Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Response } from "effect/unstable/ai";
import { BenchID, SessionID, TaskID, TrailID } from "./schema.ts";

export const SessionResult = Schema.TaggedStruct("SessionResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  id: SessionID,
  usage: Schema.NullOr(Response.Usage),
  trajectory: Prompt.Trajectory,
});
export type SessionResult = Schema.Schema.Type<typeof SessionResult>;

export const TrailResult = Schema.TaggedStruct("TrailResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  id: TrailID,
  grade: Schema.Unknown,
  sessions: Schema.Array(SessionResult),
});
export type TrailResult<G = unknown> = Readonly<{
  _tag: "TrailResult";
  startedAt: Timestamp;
  finishedAt: Timestamp;
  id: TrailID;
  grade: G;
  sessions: ReadonlyArray<SessionResult>;
}>;

export const TaskResult = Schema.TaggedStruct("TaskResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  id: TaskID,
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G = unknown> = Readonly<{
  _tag: "TaskResult";
  startedAt: Timestamp;
  finishedAt: Timestamp;
  id: TaskID;
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.TaggedStruct("BenchResult", {
  startedAt: Timestamp,
  finishedAt: Timestamp,
  id: BenchID,
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G = unknown> = Readonly<{
  _tag: "BenchResult";
  startedAt: Timestamp;
  finishedAt: Timestamp;
  id: BenchID;
  tasks: Record<string, TaskResult<G>>;
}>;
