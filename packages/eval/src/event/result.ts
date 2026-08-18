import { Timestamp } from "#/utils/schema.ts";
import { Prompt } from "@open-insight/core/internal";
import { Data, Effect, Schema } from "effect";
import { Response } from "effect/unstable/ai";

/** Carries a completed aggregate through an evaluation stream's error channel. */
export class ResultDone<A> extends Data.TaggedError("ResultDone")<{
  readonly value: A;
}> {}

export const resultDone = <A>(value: A): Effect.Effect<never, ResultDone<A>> =>
  Effect.fail(new ResultDone({ value }));

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
