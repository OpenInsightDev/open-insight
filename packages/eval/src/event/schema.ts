import * as Chart from "#/chart/index.ts";
import { Response } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Prompt, Harness } from "@open-insight/core/internal";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { Timestamp } from "#/utils/schema.ts";

export const EvalFields = {
  benchId: Schema.String,
  harnessId: Schema.String,
};
export const BenchID = Schema.Struct(EvalFields);
export type BenchID = Schema.Schema.Type<typeof BenchID>;

export const TaskFields = {
  ...EvalFields,
  taskId: Schema.String,
};
export const TaskID = Schema.Struct(TaskFields);
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TrailFields = {
  ...TaskFields,
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};
export const TrailID = Schema.Struct(TrailFields);
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionFields = {
  ...TrailFields,
  sessionIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};
export const SessionID = Schema.Struct(SessionFields);
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export class BenchStartEvent extends Schema.TaggedClass<BenchStartEvent>()("BenchStartEvent", {
  ...EvalFields,
  bench: Bench.Metadata,
  harness: Harness.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type BenchStartEventEncoded = Schema.Codec.Encoded<typeof BenchStartEvent>;

export class BenchEndEvent extends Schema.TaggedClass<BenchEndEvent>()("BenchEndEvent", {
  ...EvalFields,
  endAt: Timestamp,
}) {}
export type BenchEndEventEncoded = Schema.Codec.Encoded<typeof BenchEndEvent>;

export class BenchErrorEvent extends Schema.TaggedClass<BenchErrorEvent>()("BenchErrorEvent", {
  ...EvalFields,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class TaskStartEvent extends Schema.TaggedClass<TaskStartEvent>()("TaskStartEvent", {
  ...TaskFields,
  task: Task.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  trajMetrics: Schema.Array(Metric.Metadata),
  schedMetrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type TaskStartEventEncoded = Schema.Codec.Encoded<typeof TaskStartEvent>;

export class TaskEndEvent extends Schema.TaggedClass<TaskEndEvent>()("TaskEndEvent", {
  ...TaskFields,
  endAt: Timestamp,
}) {}
export type TaskEndEventEncoded = Schema.Codec.Encoded<typeof TaskEndEvent>;

export class TaskErrorEvent extends Schema.TaggedClass<TaskErrorEvent>()("TaskErrorEvent", {
  ...TaskFields,
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
    part: Response.AnyPart,
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
  value: Schema.Json,
  chart: Schema.NullOr(Chart.Points),
};

export class SessionMetricEvent extends Schema.TaggedClass<SessionMetricEvent>()(
  "SessionMetricEvent",
  {
    ...SessionFields,
    ...MetricFields,
  },
) {}
export type SessionMetricEventEncoded = Schema.Codec.Encoded<typeof SessionMetricEvent>;

export class SessionMetricErrorEvent extends Schema.TaggedClass<SessionMetricErrorEvent>()(
  "SessionMetricErrorEvent",
  {
    ...SessionFields,
    id: Schema.String,
    error: Schema.Defect(),
  },
) {}
export type SessionMetricErrorEventEncoded = Schema.Codec.Encoded<typeof SessionMetricErrorEvent>;

export class TrailMetricEvent extends Schema.TaggedClass<TrailMetricEvent>()("TrailMetricEvent", {
  ...TrailFields,
  ...MetricFields,
}) {}
export type TrailMetricEventEncoded = Schema.Codec.Encoded<typeof TrailMetricEvent>;

export class TrailMetricErrorEvent extends Schema.TaggedClass<TrailMetricErrorEvent>()(
  "TrailMetricErrorEvent",
  {
    ...TrailFields,
    id: Schema.String,
    error: Schema.Defect(),
  },
) {}
export type TrailMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TrailMetricErrorEvent>;

export class TaskMetricEvent extends Schema.TaggedClass<TaskMetricEvent>()("TaskMetricEvent", {
  ...TaskFields,
  ...MetricFields,
}) {}
export type TaskMetricEventEncoded = Schema.Codec.Encoded<typeof TaskMetricEvent>;

export class TaskMetricErrorEvent extends Schema.TaggedClass<TaskMetricErrorEvent>()(
  "TaskMetricErrorEvent",
  {
    ...TaskFields,
    id: Schema.String,
    error: Schema.Defect(),
  },
) {}
export type TaskMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TaskMetricErrorEvent>;

export class BenchMetricEvent extends Schema.TaggedClass<BenchMetricEvent>()("BenchMetricEvent", {
  ...EvalFields,
  ...MetricFields,
}) {}
export type BenchMetricEventEncoded = Schema.Codec.Encoded<typeof BenchMetricEvent>;

export class BenchMetricErrorEvent extends Schema.TaggedClass<BenchMetricErrorEvent>()(
  "BenchMetricErrorEvent",
  {
    ...EvalFields,
    id: Schema.String,
    error: Schema.Defect(),
  },
) {}
export type BenchMetricErrorEventEncoded = Schema.Codec.Encoded<typeof BenchMetricErrorEvent>;

export const EvalErrorEvent = Schema.Union([
  BenchErrorEvent,
  TaskErrorEvent,
  TrailErrorEvent,
  SessionErrorEvent,
  BenchMetricErrorEvent,
  TaskMetricErrorEvent,
  TrailMetricErrorEvent,
  SessionMetricErrorEvent,
]);
export type EvalErrorEvent = Schema.Schema.Type<typeof EvalErrorEvent>;

export const EvalSuccessEvent = Schema.Union([
  BenchStartEvent,
  BenchEndEvent,
  TaskStartEvent,
  TaskEndEvent,
  TrailStartEvent,
  TrailEndEvent,
  SessionStartEvent,
  SessionPromptEvent,
  SessionStreamEvent,
  SessionRetryEvent,
  SessionEndEvent,
  BenchMetricEvent,
  TaskMetricEvent,
  TrailMetricEvent,
  SessionMetricEvent,
]);
export type EvalSuccessEvent = Schema.Schema.Type<typeof EvalSuccessEvent>;

export const EvalEvent = Schema.Union([EvalSuccessEvent, EvalErrorEvent]);
export type EvalEvent = Schema.Schema.Type<typeof EvalEvent>;
export type EvalEventEncoded = Schema.Codec.Encoded<typeof EvalEvent>;

export const makeJsonSchema = () => Schema.toJsonSchemaDocument(EvalEvent);
