import * as Grade from "#/grade/index.ts";
import * as Event from "#/event/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { Prompt } from "@open-insight/core/internal";
import { DateTime, Effect, Schema } from "effect";
import { Response } from "effect/unstable/ai";

const Timestamp = Schema.DateTimeUtcFromString.pipe(
  Schema.withConstructorDefault(Effect.sync(DateTime.nowUnsafe)),
  Schema.withDecodingDefaultType(Effect.sync(DateTime.nowUnsafe)),
);
type TimestampValue = Schema.Schema.Type<typeof Timestamp>;

const TimingFields = {
  startedAt: Timestamp,
  finishedAt: Timestamp,
};

export const TrailResult = Schema.Struct({
  ...TimingFields,
  usage: Response.Usage,
  grade: Schema.Record(Schema.String, Schema.Json),
  trajectory: Prompt.Trajectory,
});
export type TrailResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: TimestampValue;
  finishedAt: TimestampValue;
  usage: Response.Usage;
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

export const TaskResult = Schema.Struct({
  ...TimingFields,
  trails: Schema.Array(TrailResult),
});
export type TaskResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: TimestampValue;
  finishedAt: TimestampValue;
  trails: ReadonlyArray<TrailResult<G>>;
}>;

export const BenchResult = Schema.Struct({
  ...TimingFields,
  tasks: Schema.Record(Schema.String, TaskResult),
});
export type BenchResult<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: TimestampValue;
  finishedAt: TimestampValue;
  tasks: Record<string, TaskResult<G>>;
}>;

export const Result = Schema.Struct({
  ...TimingFields,
  updatedAt: Timestamp,
  benchMetadata: Bench.Metadata,
  harnessMetadata: Harness.Metadata,
  result: BenchResult,
  events: Schema.Array(Event.Event),
});
export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  startedAt: TimestampValue;
  updatedAt: TimestampValue;
  finishedAt: TimestampValue;
  benchMetadata: Bench.Metadata;
  harnessMetadata: Harness.Metadata;
  result: BenchResult<G>;
  events: ReadonlyArray<Event.Event>;
}>;
