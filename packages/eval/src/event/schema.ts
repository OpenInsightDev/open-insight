import * as Chart from "#/chart/index.ts";
import { Effect, identity, Schema, SchemaTransformation } from "effect";
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

const PartTypeId = "~effect/ai/Content/Part";

// HACK Mirrors Effect's internal `Response.BasePart`: the brand key is a
// decoding-only default (so encoded parts arrive as plain objects) and
// `metadata` defaults to `{}`.
const BasePart = Schema.Struct({
  [PartTypeId]: Schema.tag(PartTypeId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(PartTypeId), { encodingStrategy: "omit" }),
  ),
  metadata: Response.ProviderMetadata.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});

// HACK `Response.ToolCallPart`/`Response.ToolResultPart` are factories parameterized
// by tool name and result schemas, so Effect does not export standalone schemas
// for them. All agents emit `StreamPartEncoded`, so decode the generic encoded
// shape into the properly branded `Response.AnyPart` variants, mirroring the
// factories with `name: Schema.String` and `params`/`result` left as
// `Schema.Unknown`.
const ToolCallPart = Schema.Struct({
  ...BasePart.fields,
  type: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown,
  providerExecuted: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});

const ToolResultPart = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("tool-result"),
  isFailure: Schema.Boolean,
  name: Schema.String,
  [PartTypeId]: Schema.Literal(PartTypeId),
  result: Schema.Unknown,
  providerExecuted: Schema.Boolean,
  metadata: Response.ProviderMetadata,
  encodedResult: Schema.Unknown,
  preliminary: Schema.Boolean,
}).pipe(
  Schema.encodeTo(
    Schema.Struct({
      id: Schema.String,
      type: Schema.Literal("tool-result"),
      isFailure: Schema.Boolean,
      name: Schema.String,
      result: Schema.Unknown,
      providerExecuted: Schema.optional(Schema.Boolean),
      metadata: Schema.optional(Response.ProviderMetadata),
      preliminary: Schema.optional(Schema.Boolean),
    }),
    SchemaTransformation.transform({
      decode: (encoded) => ({
        ...encoded,
        [PartTypeId]: PartTypeId,
        providerExecuted: encoded.providerExecuted ?? false,
        metadata: encoded.metadata ?? {},
        encodedResult: encoded.result,
        preliminary: encoded.preliminary ?? false,
      }),
      encode: identity,
    }),
  ),
);

// Effect does not export an AnyPart schema union.
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
  ToolCallPart,
  ToolResultPart,
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
