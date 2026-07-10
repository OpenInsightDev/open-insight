import { Schema, Stream } from "effect";
import type { Error } from "../error.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";
import { Response, Toolkit } from "effect/unstable/ai";

export class InitEvent extends Schema.TaggedClass<InitEvent>()("InitEvent", {
  bench: Bench.Metadata,
  harness: Harness.Metadata,
  tasks: Schema.Array(Task.Metadata),
  metrics: Schema.Array(Metric.Metadata),
}) {}

const ScheduleOpSchema = Schema.Union([
  Schema.Literal("start"),
  Schema.Literal("stop"),
  Schema.Literal("pause"),
]);

export const StreamPart = Response.StreamPart(Toolkit.empty);
export type StreamPart = typeof StreamPart.Type;
export type StreamPartEncoded = typeof StreamPart.Encoded;

export class TaskScheduleEvent extends Schema.TaggedClass<TaskScheduleEvent>()(
  "TaskScheduleEvent",
  {
    bench: Schema.String,
    harness: Schema.String,
    task: Schema.String,
    trailIndex: Schema.optional(Schema.Number),
    op: ScheduleOpSchema,
  },
) {}

export class BenchScheduleEvent extends Schema.TaggedClass<BenchScheduleEvent>()(
  "BenchScheduleEvent",
  {
    bench: Schema.String,
    harness: Schema.String,
    op: ScheduleOpSchema,
  },
) {}

export class MetricsStreamEvent extends Schema.TaggedClass<MetricsStreamEvent>()(
  "MetricsStreamEvent",
  {
    bench: Schema.String,
    harness: Schema.String,
    output: Metric.OutputSchema,
  },
) {}

export class TaskStreamPartEvent extends Schema.TaggedClass<TaskStreamPartEvent>()(
  "TaskStreamPartEvent",
  {
    bench: Schema.String,
    harness: Schema.String,
    task: Schema.String,
    trailIndex: Schema.Number,
    parts: Schema.Array(StreamPart),
  },
) {}

export const Event = Schema.Union([
  InitEvent,
  TaskScheduleEvent,
  BenchScheduleEvent,
  MetricsStreamEvent,
  TaskStreamPartEvent,
]);
export type Event = Schema.Schema.Type<typeof Event>;

export type EventStream = Stream.Stream<Event, Error>;
