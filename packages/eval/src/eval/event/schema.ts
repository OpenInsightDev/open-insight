import { Schema, Stream } from "effect";
import * as Grade from "#/grade/index.ts";
import type { Error } from "../error.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { Response, Toolkit } from "effect/unstable/ai";

const EvalFields = {
  bench: Schema.String,
  harness: Schema.String,
};

const taskFields = {
  ...EvalFields,
  task: Schema.String,
};

const TrailFields = {
  ...taskFields,
  harness: Schema.String,
};

export class InitEvent extends Schema.TaggedClass<InitEvent>()("InitEvent", {
  ...EvalFields,
  benchMetadata: Bench.Metadata,
  harnessMetadata: Harness.Metadata,
}) {}

const ScheduleOpSchema = Schema.Union([
  Schema.Literal("start"),
  Schema.Literal("stop"),
  Schema.Literal("pause"),
]);

export class EvalScheduleEvent extends Schema.TaggedClass<EvalScheduleEvent>()(
  "EvalScheduleEvent",
  {
    ...EvalFields,
    op: ScheduleOpSchema,
  },
) {}

export class TaskScheduleEvent extends Schema.TaggedClass<TaskScheduleEvent>()(
  "TaskScheduleEvent",
  {
    ...taskFields,
    op: ScheduleOpSchema,
  },
) {}

export class TrailScheduleEvent extends Schema.TaggedClass<TrailScheduleEvent>()(
  "TrailScheduleEvent",
  {
    ...TrailFields,
    op: ScheduleOpSchema,
  },
) {}

export class TrailStagedEvent extends Schema.TaggedClass<TrailStagedEvent>()("TrailStagedEvent", {
  ...TrailFields,
  stage: Schema.String,
  grade: Grade.Result,
  usage: Response.Usage,
}) {}

export const StreamPart = Response.StreamPart(Toolkit.empty);
export type StreamPart = typeof StreamPart.Type;
export type StreamPartEncoded = typeof StreamPart.Encoded;

export class TrailStreamEvent extends Schema.TaggedClass<TrailStreamEvent>()("TrailStreamEvent", {
  ...TrailFields,
  parts: Schema.Array(StreamPart),
}) {}

const MetricFields = {
  id: Schema.String,
  result: Schema.Record(Schema.String, Schema.Json),
};

export class TrajMetricEvent extends Schema.TaggedClass<TrajMetricEvent>()("TrajMetricEvent", {
  ...TrailFields,
  ...MetricFields,
}) {}

export class TaskMetricEvent extends Schema.TaggedClass<TaskMetricEvent>()("TaskMetricEvent", {
  ...taskFields,
  ...MetricFields,
}) {}

export class BenchMetricEvent extends Schema.TaggedClass<BenchMetricEvent>()("BenchMetricEvent", {
  ...EvalFields,
  ...MetricFields,
}) {}

export const Event = Schema.Union([
  InitEvent,
  EvalScheduleEvent,
  TaskScheduleEvent,
  TrailScheduleEvent,
  TrailStagedEvent,
  TrailStreamEvent,
  TrajMetricEvent,
  TaskMetricEvent,
  BenchMetricEvent,
]);
export type Event = Schema.Schema.Type<typeof Event>;

export type EventStream = Stream.Stream<Event, Error>;
