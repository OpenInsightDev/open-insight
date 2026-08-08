import * as Chart from "#/chart/index.ts";
import { Schema } from "effect";
import * as Bench from "#/bench/index.ts";
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
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};

export class InitEvent extends Schema.TaggedClass<InitEvent>()("InitEvent", {
  ...EvalFields,
  benchMetadata: Bench.Metadata,
}) {}
export type InitEventEncoded = Schema.Codec.Encoded<typeof InitEvent>;

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
export type EvalScheduleEventEncoded = Schema.Codec.Encoded<typeof EvalScheduleEvent>;

export class TaskScheduleEvent extends Schema.TaggedClass<TaskScheduleEvent>()(
  "TaskScheduleEvent",
  {
    ...taskFields,
    op: ScheduleOpSchema,
  },
) {}
export type TaskScheduleEventEncoded = Schema.Codec.Encoded<typeof TaskScheduleEvent>;

export class TrailScheduleEvent extends Schema.TaggedClass<TrailScheduleEvent>()(
  "TrailScheduleEvent",
  {
    ...TrailFields,
    op: ScheduleOpSchema,
  },
) {}
export type TrailScheduleEventEncoded = Schema.Codec.Encoded<typeof TrailScheduleEvent>;

export class TrailStagedEvent extends Schema.TaggedClass<TrailStagedEvent>()("TrailStagedEvent", {
  ...TrailFields,
  stage: Schema.String,
  grade: Schema.Unknown,
  usage: Schema.NullOr(Response.Usage),
}) {}
export type TrailStagedEventEncoded = Schema.Codec.Encoded<typeof TrailStagedEvent>;

export const TrailStreamEvent = <T extends Toolkit.Any>(toolkit: T) =>
  class TrailStreamEvent extends Schema.TaggedClass<TrailStreamEvent>()("TrailStreamEvent", {
    ...TrailFields,
    part: Response.StreamPart(toolkit),
  }) {};

export type TrailStreamEventEncoded = Schema.Codec.Encoded<
  ReturnType<typeof TrailStreamEvent<Toolkit.Any>>
>;

const MetricFields = {
  id: Schema.String,
  result: Schema.Record(Schema.String, Schema.Json),
  chart: Schema.NullOr(Chart.DataPoints),
};

export class TrajMetricEvent extends Schema.TaggedClass<TrajMetricEvent>()("TrajMetricEvent", {
  ...TrailFields,
  ...MetricFields,
}) {}
export type TrajMetricEventEncoded = Schema.Codec.Encoded<typeof TrajMetricEvent>;

export class TaskMetricEvent extends Schema.TaggedClass<TaskMetricEvent>()("TaskMetricEvent", {
  ...taskFields,
  ...MetricFields,
}) {}
export type TaskMetricEventEncoded = Schema.Codec.Encoded<typeof TaskMetricEvent>;

export class BenchMetricEvent extends Schema.TaggedClass<BenchMetricEvent>()("BenchMetricEvent", {
  ...EvalFields,
  ...MetricFields,
}) {}
export type BenchMetricEventEncoded = Schema.Codec.Encoded<typeof BenchMetricEvent>;

export const EvalEvent = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.Union([
    InitEvent,
    EvalScheduleEvent,
    TaskScheduleEvent,
    TrailScheduleEvent,
    TrailStagedEvent,
    TrailStreamEvent(toolkit),
    TrajMetricEvent,
    TaskMetricEvent,
    BenchMetricEvent,
  ]);
export type EvalEvent<T extends Toolkit.Any = Toolkit.Any> = Schema.Schema.Type<
  ReturnType<typeof EvalEvent<T>>
>;
export type EvalEventEncoded = Schema.Codec.Encoded<ReturnType<typeof EvalEvent<Toolkit.Any>>>;
