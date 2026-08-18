import * as Chart from "#/chart/index.ts";
import { Response } from "@open-insight/core/internal";
import { Schema } from "effect";
import { Prompt, Harness } from "@open-insight/core/internal";
import * as Bench from "#/bench/index.ts";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { Timestamp } from "#/utils/schema.ts";

export const BenchID = Schema.Struct({
  benchId: Schema.String,
  harnessId: Schema.String,
});
export type BenchID = Schema.Schema.Type<typeof BenchID>;

export const BenchMetricID = Schema.Struct({
  ...BenchID.fields,
  id: Schema.String,
});
export type BenchMetricID = Schema.Schema.Type<typeof BenchMetricID>;

export const TaskID = Schema.Struct({
  ...BenchID.fields,
  taskId: Schema.String,
});
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TaskMetricID = Schema.Struct({
  ...TaskID.fields,
  id: Schema.String,
});
export type TaskMetricID = Schema.Schema.Type<typeof TaskMetricID>;

export const TrailID = Schema.Struct({
  ...TaskID.fields,
  trailIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SchedMetricID = Schema.Struct({
  ...TrailID.fields,
  id: Schema.String,
});
export type SchedMetricID = Schema.Schema.Type<typeof SchedMetricID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export const TrajMetricID = Schema.Struct({
  ...SessionID.fields,
  id: Schema.String,
});
export type TrajMetricID = Schema.Schema.Type<typeof TrajMetricID>;

export class BenchStartEvent extends Schema.TaggedClass<BenchStartEvent>()("BenchStartEvent", {
  id: BenchID,
  bench: Bench.Metadata,
  harness: Harness.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type BenchStartEventEncoded = Schema.Codec.Encoded<typeof BenchStartEvent>;

export class BenchEndEvent extends Schema.TaggedClass<BenchEndEvent>()("BenchEndEvent", {
  id: BenchID,
  endAt: Timestamp,
}) {}
export type BenchEndEventEncoded = Schema.Codec.Encoded<typeof BenchEndEvent>;

export class BenchErrorEvent extends Schema.TaggedClass<BenchErrorEvent>()("BenchErrorEvent", {
  id: BenchID,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class TaskStartEvent extends Schema.TaggedClass<TaskStartEvent>()("TaskStartEvent", {
  id: TaskID,
  task: Task.Metadata,
  metrics: Schema.Array(Metric.Metadata),
  trajMetrics: Schema.Array(Metric.Metadata),
  schedMetrics: Schema.Array(Metric.Metadata),
  startAt: Timestamp,
}) {}
export type TaskStartEventEncoded = Schema.Codec.Encoded<typeof TaskStartEvent>;

export class TaskEndEvent extends Schema.TaggedClass<TaskEndEvent>()("TaskEndEvent", {
  id: TaskID,
  endAt: Timestamp,
}) {}
export type TaskEndEventEncoded = Schema.Codec.Encoded<typeof TaskEndEvent>;

export class TaskErrorEvent extends Schema.TaggedClass<TaskErrorEvent>()("TaskErrorEvent", {
  id: TaskID,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class TrailStartEvent extends Schema.TaggedClass<TrailStartEvent>()("TrailStartEvent", {
  id: TrailID,
  startAt: Timestamp,
}) {}
export type TrailStartEventEncoded = Schema.Codec.Encoded<typeof TrailStartEvent>;

export class TrailEndEvent extends Schema.TaggedClass<TrailEndEvent>()("TrailEndEvent", {
  id: TrailID,
  grade: Schema.Unknown,
  usage: Schema.NullOr(Response.Usage),
  endAt: Timestamp,
}) {}
export type TrailEndEventEncoded = Schema.Codec.Encoded<typeof TrailEndEvent>;

export class TrailErrorEvent extends Schema.TaggedClass<TrailErrorEvent>()("TrailErrorEvent", {
  id: TrailID,
  error: Schema.Defect(),
  endAt: Timestamp,
}) {}

export class SessionStartEvent extends Schema.TaggedClass<SessionStartEvent>()(
  "SessionStartEvent",
  {
    id: SessionID,
    startAt: Timestamp,
  },
) {}

export class SessionPromptEvent extends Schema.TaggedClass<SessionPromptEvent>()(
  "SessionPromptEvent",
  {
    id: SessionID,
    prompt: Prompt.Prompt,
  },
) {}

export class SessionStreamEvent extends Schema.TaggedClass<SessionStreamEvent>()(
  "SessionStreamEvent",
  {
    id: SessionID,
    part: Response.AnyPart,
  },
) {}
export type SessionStreamEventEncoded = Schema.Codec.Encoded<typeof SessionStreamEvent>;

export class SessionRetryEvent extends Schema.TaggedClass<SessionRetryEvent>()(
  "SessionRetryEvent",
  {
    id: SessionID,
    reason: Schema.NullOr(Schema.String),
  },
) {}

export class SessionEndEvent extends Schema.TaggedClass<SessionEndEvent>()("SessionEndEvent", {
  id: SessionID,
  reason: Response.FinishReason,
  endAt: Timestamp,
}) {}

export class SessionErrorEvent extends Schema.TaggedClass<SessionErrorEvent>()(
  "SessionErrorEvent",
  {
    id: SessionID,
    error: Schema.Defect(),
    endAt: Timestamp,
  },
) {}

export class SessionMetricEvent extends Schema.TaggedClass<SessionMetricEvent>()(
  "SessionMetricEvent",
  {
    id: TrajMetricID,
    value: Schema.Json,
    chart: Schema.NullOr(Chart.Points),
  },
) {}
export type SessionMetricEventEncoded = Schema.Codec.Encoded<typeof SessionMetricEvent>;

export class SessionMetricErrorEvent extends Schema.TaggedClass<SessionMetricErrorEvent>()(
  "SessionMetricErrorEvent",
  {
    id: TrajMetricID,
    error: Schema.Defect(),
  },
) {}
export type SessionMetricErrorEventEncoded = Schema.Codec.Encoded<typeof SessionMetricErrorEvent>;

export class TrailMetricEvent extends Schema.TaggedClass<TrailMetricEvent>()("TrailMetricEvent", {
  id: SchedMetricID,
  value: Schema.Json,
  chart: Schema.NullOr(Chart.Points),
}) {}
export type TrailMetricEventEncoded = Schema.Codec.Encoded<typeof TrailMetricEvent>;

export class TrailMetricErrorEvent extends Schema.TaggedClass<TrailMetricErrorEvent>()(
  "TrailMetricErrorEvent",
  {
    id: SchedMetricID,
    error: Schema.Defect(),
  },
) {}
export type TrailMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TrailMetricErrorEvent>;

export class TaskMetricEvent extends Schema.TaggedClass<TaskMetricEvent>()("TaskMetricEvent", {
  id: TaskMetricID,
  value: Schema.Json,
  chart: Schema.NullOr(Chart.Points),
}) {}
export type TaskMetricEventEncoded = Schema.Codec.Encoded<typeof TaskMetricEvent>;

export class TaskMetricErrorEvent extends Schema.TaggedClass<TaskMetricErrorEvent>()(
  "TaskMetricErrorEvent",
  {
    id: TaskMetricID,
    error: Schema.Defect(),
  },
) {}
export type TaskMetricErrorEventEncoded = Schema.Codec.Encoded<typeof TaskMetricErrorEvent>;

export class BenchMetricEvent extends Schema.TaggedClass<BenchMetricEvent>()("BenchMetricEvent", {
  id: BenchMetricID,
  value: Schema.Json,
  chart: Schema.NullOr(Chart.Points),
}) {}
export type BenchMetricEventEncoded = Schema.Codec.Encoded<typeof BenchMetricEvent>;

export class BenchMetricErrorEvent extends Schema.TaggedClass<BenchMetricErrorEvent>()(
  "BenchMetricErrorEvent",
  {
    id: BenchMetricID,
    error: Schema.Defect(),
  },
) {}
export type BenchMetricErrorEventEncoded = Schema.Codec.Encoded<typeof BenchMetricErrorEvent>;

export const SessionSuccessEvent = Schema.Union([
  SessionStartEvent,
  SessionPromptEvent,
  SessionStreamEvent,
  SessionRetryEvent,
  SessionEndEvent,
  SessionMetricEvent,
]);
export type SessionSuccessEvent = Schema.Schema.Type<typeof SessionSuccessEvent>;

export const SessionEvent = Schema.Union([
  SessionSuccessEvent,
  SessionErrorEvent,
  SessionMetricErrorEvent,
]);
export type SessionEvent = Schema.Schema.Type<typeof SessionEvent>;

export const TrailSuccessEvent = Schema.Union([
  TrailStartEvent,
  TrailEndEvent,
  TrailMetricEvent,
  SessionSuccessEvent,
]);
export type TrailSuccessEvent = Schema.Schema.Type<typeof TrailSuccessEvent>;

export const TrailEvent = Schema.Union([
  TrailSuccessEvent,
  TrailErrorEvent,
  TrailMetricErrorEvent,
  SessionEvent,
]);
export type TrailEvent = Schema.Schema.Type<typeof TrailEvent>;

export const TaskSuccessEvent = Schema.Union([
  TaskStartEvent,
  TaskEndEvent,
  TaskMetricEvent,
  TrailSuccessEvent,
]);
export type TaskSuccessEvent = Schema.Schema.Type<typeof TaskSuccessEvent>;

export const TaskEvent = Schema.Union([
  TaskSuccessEvent,
  TaskErrorEvent,
  TaskMetricErrorEvent,
  TrailEvent,
]);
export type TaskEvent = Schema.Schema.Type<typeof TaskEvent>;

export const BenchSuccessEvent = Schema.Union([
  BenchStartEvent,
  BenchEndEvent,
  BenchMetricEvent,
  TaskSuccessEvent,
]);
export type BenchSuccessEvent = Schema.Schema.Type<typeof BenchSuccessEvent>;

export const BenchEvent = Schema.Union([
  BenchSuccessEvent,
  BenchErrorEvent,
  BenchMetricErrorEvent,
  TaskEvent,
]);
export type BenchEvent = Schema.Schema.Type<typeof BenchEvent>;

export const EvalSuccessEvent = BenchSuccessEvent;
export type EvalSuccessEvent = Schema.Schema.Type<typeof EvalSuccessEvent>;

export const EvalErrorEvent = Schema.Union([
  SessionErrorEvent,
  SessionMetricErrorEvent,
  TrailErrorEvent,
  TrailMetricErrorEvent,
  TaskErrorEvent,
  TaskMetricErrorEvent,
  BenchErrorEvent,
  BenchMetricErrorEvent,
]);
export type EvalErrorEvent = Schema.Schema.Type<typeof EvalErrorEvent>;

export const EvalEvent = Schema.Union([EvalSuccessEvent, EvalErrorEvent]);
export type EvalEvent = Schema.Schema.Type<typeof EvalEvent>;
export type EvalEventEncoded = Schema.Codec.Encoded<typeof EvalEvent>;

export const makeJsonSchema = () => Schema.toJsonSchemaDocument(EvalEvent);
