import * as Chart from "#/chart/index.ts";
import { Schema, SchemaTransformation } from "effect";
import * as Grade from "#/grade/index.ts";
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
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
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

const GenericToolCallPart = Schema.Struct({
  ...Response.ToolCallPart("DynamicTool", Schema.Json).fields,
  name: Schema.String,
});

const responsePartTypeId = "~effect/ai/Content/Part";
const GenericToolResultPart = Schema.Struct({
  [responsePartTypeId]: Schema.Literal(responsePartTypeId),
  metadata: Response.ProviderMetadata,
  type: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: Schema.Json,
  encodedResult: Schema.Json,
  isFailure: Schema.Boolean,
  providerExecuted: Schema.Boolean,
  preliminary: Schema.Boolean,
}).pipe(
  Schema.encodeTo(
    Schema.Struct({
      metadata: Schema.optional(Response.ProviderMetadata),
      type: Schema.Literal("tool-result"),
      id: Schema.String,
      name: Schema.String,
      result: Schema.Json,
      isFailure: Schema.Boolean,
      providerExecuted: Schema.optional(Schema.Boolean),
      preliminary: Schema.optional(Schema.Boolean),
    }),
    SchemaTransformation.transform({
      decode: (encoded) => ({
        ...encoded,
        [responsePartTypeId]: responsePartTypeId,
        metadata: encoded.metadata ?? {},
        encodedResult: encoded.result,
        providerExecuted: encoded.providerExecuted ?? false,
        preliminary: encoded.preliminary ?? false,
      }),
      encode: (decoded) => ({
        metadata: decoded.metadata,
        type: decoded.type,
        id: decoded.id,
        name: decoded.name,
        result: decoded.encodedResult,
        isFailure: decoded.isFailure,
        providerExecuted: decoded.providerExecuted,
        preliminary: decoded.preliminary,
      }),
    }),
  ),
);

export const StreamPart = Schema.Union([
  Response.StreamPart(Toolkit.empty),
  GenericToolCallPart,
  GenericToolResultPart,
]);
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
