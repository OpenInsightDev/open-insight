import * as Chart from "#/chart/index.ts";
import { Response } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Prompt, Harness } from "@open-insight/core/internal";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { Timestamp } from "#/utils/schema.ts";

export const BenchFields = {
  benchId: Schema.String,
  harnessId: Schema.String,
};
export const BenchID = Schema.Struct(BenchFields);
export type BenchID = Schema.Schema.Type<typeof BenchID>;

export const BenchMetricFields = {
  ...BenchFields,
  id: Schema.String,
};
export const BenchMetricID = Schema.Struct(BenchMetricFields);
export type BenchMetricID = Schema.Schema.Type<typeof BenchMetricID>;

export const TaskFields = {
  ...BenchFields,
  taskId: Schema.String,
};
export const TaskID = Schema.Struct(TaskFields);
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TaskMetricFields = {
  ...TaskFields,
  id: Schema.String,
};
export const TaskMetricID = Schema.Struct(TaskMetricFields);
export type TaskMetricID = Schema.Schema.Type<typeof TaskMetricID>;

export const TrailFields = {
  ...TaskFields,
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};
export const TrailID = Schema.Struct(TrailFields);
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SchedMetricFields = {
  ...TrailFields,
  id: Schema.String,
};
export const SchedMetricID = Schema.Struct(SchedMetricFields);
export type SchedMetricID = Schema.Schema.Type<typeof SchedMetricID>;

export const SessionFields = {
  ...TrailFields,
  sessionIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
};
export const SessionID = Schema.Struct(SessionFields);
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export const TrajMetricFields = {
  ...SessionFields,
  id: Schema.String,
};
export const TrajMetricID = Schema.Struct(TrajMetricFields);
export type TrajMetricID = Schema.Schema.Type<typeof TrajMetricID>;

export class BenchStartEvent extends Schema.TaggedClass<BenchStartEvent>()("BenchStartEvent", {
  ...BenchFields,
  bench: Bench.Metadata,
  harness: Harness.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type BenchStartEventEncoded = Schema.Codec.Encoded<typeof BenchStartEvent>;

export class BenchEndEvent extends Schema.TaggedClass<BenchEndEvent>()("BenchEndEvent", {
  ...BenchFields,
  endAt: Timestamp,
}) {}
export type BenchEndEventEncoded = Schema.Codec.Encoded<typeof BenchEndEvent>;

export class BenchErrorEvent extends Schema.TaggedClass<BenchErrorEvent>()("BenchErrorEvent", {
  ...BenchFields,
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

export class SessionMetricEvent extends Schema.TaggedClass<SessionMetricEvent>()(
  "SessionMetricEvent",
  {
    ...TrajMetricFields,
    value: Schema.Json,
    chart: Schema.NullOr(Chart.Points),
  },
) {}
export type SessionMetricEventEncoded = Schema.Codec.Encoded<typeof SessionMetricEvent>;

export class SessionMetricErrorEvent extends Schema.TaggedClass<SessionMetricErrorEvent>()(
  "SessionMetricErrorEvent",
  {
    ...TrajMetricFields,
    error: Schema.Defect(),
  },
) {}
export type SessionMetricErrorEventEncoded = Schema.Codec.Encoded<typeof SessionMetricErrorEvent>;

export class TrailMetricEvent extends Schema.TaggedClass<TrailMetricEvent>()(
  "TrailMetricEvent",
  {
    ...SchedMetricFields,
    value: Schema.Json,
    chart: Schema.NullOr(Chart.Points),
  },
) {}
export type TrailMetricEventEncoded = Schema.Codec.Encoded<typeof TrailMetricEvent>;

export class TrailMetricErrorEvent extends Schema.TaggedClass<TrailMetricErrorEvent>()(
  "TrailMetricErrorEvent",
  {
    ...SchedMetricFields,
    error: Schema.Defect(),
  },
) {}
export type TrailMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TrailMetricErrorEvent>;

export class TaskMetricEvent extends Schema.TaggedClass<TaskMetricEvent>()(
  "TaskMetricEvent",
  {
    ...TaskMetricFields,
    value: Schema.Json,
    chart: Schema.NullOr(Chart.Points),
  },
) {}
export type TaskMetricEventEncoded = Schema.Codec.Encoded<typeof TaskMetricEvent>;

export class TaskMetricErrorEvent extends Schema.TaggedClass<TaskMetricErrorEvent>()(
  "TaskMetricErrorEvent",
  {
    ...TaskMetricFields,
    error: Schema.Defect(),
  },
) {}
export type TaskMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TaskMetricErrorEvent>;

export class BenchMetricEvent extends Schema.TaggedClass<BenchMetricEvent>()(
  "BenchMetricEvent",
  {
    ...BenchMetricFields,
    value: Schema.Json,
    chart: Schema.NullOr(Chart.Points),
  },
) {}
export type BenchMetricEventEncoded = Schema.Codec.Encoded<typeof BenchMetricEvent>;

export class BenchMetricErrorEvent extends Schema.TaggedClass<BenchMetricErrorEvent>()(
  "BenchMetricErrorEvent",
  {
    ...BenchMetricFields,
    error: Schema.Defect(),
  },
) {}
export type BenchMetricErrorEventEncoded = Schema.Codec.Encoded<typeof BenchMetricErrorEvent>;

export const BenchSuccessEvent = Schema.Union([
  BenchStartEvent,
  BenchEndEvent,
  BenchMetricEvent,
]);
export type BenchSuccessEvent = Schema.Schema.Type<typeof BenchSuccessEvent>;

export const BenchEventError = Schema.Union([
  BenchErrorEvent,
  BenchMetricErrorEvent,
]);
export type BenchEventError = Schema.Schema.Type<typeof BenchEventError>;

export const BenchEvent = Schema.Union([BenchSuccessEvent, BenchEventError]);
export type BenchEvent = Schema.Schema.Type<typeof BenchEvent>;

export const TaskSuccessEvent = Schema.Union([
  TaskStartEvent,
  TaskEndEvent,
  TaskMetricEvent,
]);
export type TaskSuccessEvent = Schema.Schema.Type<typeof TaskSuccessEvent>;

export const TaskEventError = Schema.Union([
  TaskErrorEvent,
  TaskMetricErrorEvent,
]);
export type TaskEventError = Schema.Schema.Type<typeof TaskEventError>;

export const TaskEvent = Schema.Union([TaskSuccessEvent, TaskEventError]);
export type TaskEvent = Schema.Schema.Type<typeof TaskEvent>;

export const TrailSuccessEvent = Schema.Union([
  TrailStartEvent,
  TrailEndEvent,
  TrailMetricEvent,
]);
export type TrailSuccessEvent = Schema.Schema.Type<typeof TrailSuccessEvent>;

export const TrailEventError = Schema.Union([
  TrailErrorEvent,
  TrailMetricErrorEvent,
]);
export type TrailEventError = Schema.Schema.Type<typeof TrailEventError>;

export const TrailEvent = Schema.Union([TrailSuccessEvent, TrailEventError]);
export type TrailEvent = Schema.Schema.Type<typeof TrailEvent>;

export const SessionSuccessEvent = Schema.Union([
  SessionStartEvent,
  SessionPromptEvent,
  SessionStreamEvent,
  SessionRetryEvent,
  SessionEndEvent,
  SessionMetricEvent,
]);
export type SessionSuccessEvent = Schema.Schema.Type<typeof SessionSuccessEvent>;

export const SessionEventError = Schema.Union([
  SessionErrorEvent,
  SessionMetricErrorEvent,
]);
export type SessionEventError = Schema.Schema.Type<typeof SessionEventError>;

export const SessionEvent = Schema.Union([SessionSuccessEvent, SessionEventError]);
export type SessionEvent = Schema.Schema.Type<typeof SessionEvent>;

export const EvalErrorEvent = Schema.Union([
  BenchEventError,
  TaskEventError,
  TrailEventError,
  SessionEventError,
]);
export type EvalErrorEvent = Schema.Schema.Type<typeof EvalErrorEvent>;

export const EvalSuccessEvent = Schema.Union([
  BenchSuccessEvent,
  TaskSuccessEvent,
  TrailSuccessEvent,
  SessionSuccessEvent,
]);
export type EvalSuccessEvent = Schema.Schema.Type<typeof EvalSuccessEvent>;

export const EvalEvent = Schema.Union([EvalSuccessEvent, EvalErrorEvent]);
export type EvalEvent = Schema.Schema.Type<typeof EvalEvent>;
export type EvalEventEncoded = Schema.Codec.Encoded<typeof EvalEvent>;

export const makeJsonSchema = () => Schema.toJsonSchemaDocument(EvalEvent);
