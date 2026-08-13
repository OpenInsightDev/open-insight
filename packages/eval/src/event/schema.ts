import * as Chart from "#/chart/index.ts";
import { Response } from "effect/unstable/ai";
import { Schema } from "effect";
import { Prompt, Harness } from "@open-insight/core/internal";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { Timestamp } from "../utils/schema.ts";

const EvalFields = {
  benchId: Schema.String,
  harnessId: Schema.String,
};

const taskFields = {
  ...EvalFields,
  taskId: Schema.String,
};

const TrailFields = {
  ...taskFields,
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};

const SessionFields = {
  ...TrailFields,
  sessionIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};

export class EvalStartEvent extends Schema.TaggedClass<EvalStartEvent>()("EvalStartEvent", {
  ...EvalFields,
  bench: Bench.Metadata,
  harness: Harness.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type EvalStartEventEncoded = Schema.Codec.Encoded<typeof EvalStartEvent>;

export class EvalEndEvent extends Schema.TaggedClass<EvalEndEvent>()("EvalEndEvent", {
  ...EvalFields,
  endAt: Timestamp,
}) {}
export type EvalEndEventEncoded = Schema.Codec.Encoded<typeof EvalEndEvent>;

export class EvalErrorEvent extends Schema.TaggedClass<EvalErrorEvent>()("EvalErrorEvent", {
  ...EvalFields,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class TaskStartEvent extends Schema.TaggedClass<TaskStartEvent>()("TaskStartEvent", {
  ...taskFields,
  task: Task.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  trajMetrics: Schema.Array(Metric.Metadata),
  schedMetrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type TaskStartEventEncoded = Schema.Codec.Encoded<typeof TaskStartEvent>;

export class TaskEndEvent extends Schema.TaggedClass<TaskEndEvent>()("TaskEndEvent", {
  ...taskFields,
  endAt: Timestamp,
}) {}
export type TaskEndEventEncoded = Schema.Codec.Encoded<typeof TaskEndEvent>;

export class TaskErrorEvent extends Schema.TaggedClass<TaskErrorEvent>()("TaskErrorEvent", {
  ...taskFields,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class TrailStartEvent extends Schema.TaggedClass<TrailStartEvent>()("TrailStartEvent", {
  ...TrailFields,
  startAt: Timestamp,
}) {}
export type TrailStartEventEncoded = Schema.Codec.Encoded<typeof TrailStartEvent>;

export class TrailEndEvent extends Schema.TaggedClass<TrailEndEvent>()("TrailEndEvent", {
  ...TrailFields,
  grade: Schema.Unknown,
  usage: Schema.NullOr(Response.Usage),
  endAt: Timestamp,
}) {}
export type TrailEndEventEncoded = Schema.Codec.Encoded<typeof TrailEndEvent>;

export class TrailErrorEvent extends Schema.TaggedClass<TrailErrorEvent>()("TrailErrorEvent", {
  ...TrailFields,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class SessionStartEvent extends Schema.TaggedClass<SessionStartEvent>()(
  "SessionStartEvent",
  {
    ...SessionFields,
    startAt: Timestamp,
  },
) {}

export class SessionPromptEvent extends Schema.TaggedClass<SessionPromptEvent>()(
  "SessionPromptEvent",
  {
    ...SessionFields,
    prompt: Prompt.Prompt,
  },
) {}

export class SessionStreamEvent extends Schema.TaggedClass<SessionStreamEvent>()(
  "SessionStreamEvent",
  {
    ...SessionFields,
    part: Prompt.AnyStreamPart,
  },
) {}
export type SessionStreamEventEncoded = Schema.Codec.Encoded<typeof SessionStreamEvent>;

export class SessionRetryEvent extends Schema.TaggedClass<SessionRetryEvent>()(
  "SessionRetryEvent",
  {
    ...SessionFields,
    reason: Schema.NullOr(Schema.String),
  },
) {}

export class SessionEndEvent extends Schema.TaggedClass<SessionEndEvent>()("SessionEndEvent", {
  ...SessionFields,
  reason: Response.FinishReason,
  endAt: Timestamp,
}) {}

export class SessionErrorEvent extends Schema.TaggedClass<SessionErrorEvent>()(
  "SessionErrorEvent",
  {
    ...SessionFields,
    error: Schema.Defect(),
    endAt: Timestamp,
  },
) {}

const MetricFields = {
  id: Schema.String,
  result: Schema.Json,
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

export const EvalEvent = Schema.Union([
  EvalStartEvent,
  EvalEndEvent,
  EvalErrorEvent,
  TaskStartEvent,
  TaskEndEvent,
  TaskErrorEvent,
  TrailStartEvent,
  TrailEndEvent,
  TrailErrorEvent,
  SessionStartEvent,
  SessionPromptEvent,
  SessionStreamEvent,
  SessionRetryEvent,
  SessionEndEvent,
  SessionErrorEvent,
  TrajMetricEvent,
  TaskMetricEvent,
  BenchMetricEvent,
]);
export type EvalEvent = Schema.Schema.Type<typeof EvalEvent>;
export type EvalEventEncoded = Schema.Codec.Encoded<typeof EvalEvent>;
