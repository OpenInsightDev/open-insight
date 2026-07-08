import { Schema, Stream } from "effect";
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

const FinishReasonSchema = Schema.Literals([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "error",
  "pause",
  "other",
  "unknown",
]);

const PartMetadata = {
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
};

const TextStartPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("text-start"),
  id: Schema.String,
});

const TextDeltaPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("text-delta"),
  id: Schema.String,
  delta: Schema.String,
});

const TextEndPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("text-end"),
  id: Schema.String,
});

const ReasoningStartPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("reasoning-start"),
  id: Schema.String,
});

const ReasoningDeltaPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("reasoning-delta"),
  id: Schema.String,
  delta: Schema.String,
});

const ReasoningEndPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("reasoning-end"),
  id: Schema.String,
});

const ToolParamsStartPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-params-start"),
  id: Schema.String,
  name: Schema.String,
  providerExecuted: Schema.optional(Schema.Boolean),
});

const ToolParamsDeltaPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-params-delta"),
  id: Schema.String,
  delta: Schema.String,
});

const ToolParamsEndPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-params-end"),
  id: Schema.String,
});

const ToolCallPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown,
  providerExecuted: Schema.optional(Schema.Boolean),
});

const ToolResultPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: Schema.Unknown,
  encodedResult: Schema.optional(Schema.Unknown),
  isFailure: Schema.Boolean,
  providerExecuted: Schema.optional(Schema.Boolean),
  preliminary: Schema.optional(Schema.Boolean),
});

const ToolApprovalRequestPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("tool-approval-request"),
  approvalId: Schema.String,
  toolCallId: Schema.String,
});

const FilePart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("file"),
  mediaType: Schema.String,
  data: Schema.Unknown,
});

const DocumentSourcePart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("source"),
  sourceType: Schema.Literal("document"),
  id: Schema.String,
  mediaType: Schema.String,
  title: Schema.String,
  fileName: Schema.optional(Schema.String),
});

const UrlSourcePart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("source"),
  sourceType: Schema.Literal("url"),
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
});

const ResponseMetadataPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("response-metadata"),
  id: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.Unknown),
  request: Schema.optional(Schema.Unknown),
});

const FinishPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("finish"),
  reason: FinishReasonSchema,
  usage: Schema.optional(Schema.Unknown),
  response: Schema.optional(Schema.Unknown),
});

const ErrorPart = Schema.Struct({
  ...PartMetadata,
  type: Schema.Literal("error"),
  error: Schema.Unknown,
});

export const StreamPart = Schema.Union([
  TextStartPart,
  TextDeltaPart,
  TextEndPart,
  ReasoningStartPart,
  ReasoningDeltaPart,
  ReasoningEndPart,
  ToolParamsStartPart,
  ToolParamsDeltaPart,
  ToolParamsEndPart,
  ToolCallPart,
  ToolResultPart,
  ToolApprovalRequestPart,
  FilePart,
  DocumentSourcePart,
  UrlSourcePart,
  ResponseMetadataPart,
  FinishPart,
  ErrorPart,
]);
export type StreamPart = typeof StreamPart.Type;

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
