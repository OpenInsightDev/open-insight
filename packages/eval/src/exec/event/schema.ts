import { Schema, Stream } from "effect";
import { Response, Toolkit } from "effect/unstable/ai";
import type { Error } from "../error.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import * as Bench from "#/benchmark/index.ts";

export class InitEvent extends Schema.TaggedClass<InitEvent>()("InitEvent", {
  bench: Bench.Metadata,
  tasks: Schema.Array(Task.Metadata),
  metrics: Schema.Array(Metric.Metadata),
}) {}

const ScheduleOpSchema = Schema.Union([
  Schema.Literal("start"),
  Schema.Literal("stop"),
  Schema.Literal("pause"),
]);

export class TaskScheduleEvent extends Schema.TaggedClass<TaskScheduleEvent>()(
  "TaskScheduleEvent",
  {
    bench: Schema.String,
    task: Schema.String,
    trailIndex: Schema.optional(Schema.Number),
    op: ScheduleOpSchema,
  },
) {}

export class BenchScheduleEvent extends Schema.TaggedClass<BenchScheduleEvent>()(
  "BenchScheduleEvent",
  {
    bench: Schema.String,
    op: ScheduleOpSchema,
  },
) {}

export class MetricsStreamEvent extends Schema.TaggedClass<MetricsStreamEvent>()(
  "MetricsStreamEvent",
  {
    bench: Schema.String,
    output: Metric.OutputSchema,
  },
) {}

export class TaskStreamPartEvent extends Schema.TaggedClass<TaskStreamPartEvent>()(
  "TaskStreamPartEvent",
  {
    bench: Schema.String,
    task: Schema.String,
    trailIndex: Schema.Number,
    parts: Schema.Array(Response.StreamPart(Toolkit.empty)),
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
