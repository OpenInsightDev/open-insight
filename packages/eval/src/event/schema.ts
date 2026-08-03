import * as Chart from "#/chart/index.ts";
import { Schema } from "effect";
import * as Bench from "#/bench/index.ts";
import { Response } from "effect/unstable/ai";

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
  grade: Schema.Unknown,
  usage: Schema.NullOr(Response.Usage),
}) {}

type ToolPart = Extract<Response.AnyPart, { readonly type: "tool-call" | "tool-result" }>;

const ToolPart = Schema.declare(
  (input): input is ToolPart =>
    Response.isPart(input) && (input.type === "tool-call" || input.type === "tool-result"),
  { identifier: "ToolPart" },
);

// HACK for some reason Effect does not export an AnyPart schema union.
export const AnyPart = Schema.Union([
  Response.TextPart,
  Response.TextStartPart,
  Response.TextDeltaPart,
  Response.TextEndPart,
  Response.ReasoningPart,
  Response.ReasoningStartPart,
  Response.ReasoningDeltaPart,
  Response.ReasoningEndPart,
  Response.ToolParamsStartPart,
  Response.ToolParamsDeltaPart,
  Response.ToolParamsEndPart,
  ToolPart,
  Response.ToolApprovalRequestPart,
  Response.FilePart,
  Response.DocumentSourcePart,
  Response.UrlSourcePart,
  Response.ResponseMetadataPart,
  Response.FinishPart,
  Response.ErrorPart,
]) satisfies Schema.Codec<Response.AnyPart, Response.AnyPartEncoded>;

export const StreamPart = AnyPart;
export type StreamPart = typeof StreamPart.Type;
export type StreamPartEncoded = typeof StreamPart.Encoded;

export class TrailStreamEvent extends Schema.TaggedClass<TrailStreamEvent>()("TrailStreamEvent", {
  ...TrailFields,
  part: StreamPart,
}) {}

const MetricFields = {
  id: Schema.String,
  result: Schema.Record(Schema.String, Schema.Json),
  chart: Schema.NullOr(Chart.DataPoints),
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
export type EventEncoded = Schema.Codec.Encoded<typeof Event>;
