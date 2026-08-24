import { Schema } from "effect";
import * as Chart from "#/chart/index.ts";
import { Response } from "effect/unstable/ai";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";

export const EvalID = Schema.Struct({
  benchID: Schema.String,
  harnessID: Schema.String,
});
export type EvalID = Schema.Schema.Type<typeof EvalID>;

export const TaskID = Schema.Struct({
  ...EvalID.fields,
  taskID: Schema.String,
});
export type TaskID = Schema.Schema.Type<typeof TaskID>;

export const TrailID = Schema.Struct({
  ...TaskID.fields,
  trailIdx: Schema.String,
});
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.String,
});
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export const EvalStartEvent = Schema.Struct({
  id: EvalID,
});
export type EvalStartEvent = Schema.Schema.Type<typeof EvalStartEvent>;

export const EvalErrorEvent = Schema.Struct({
  id: EvalID,
  error: Schema.Defect(),
});
export type EvalErrorEvent = Schema.Schema.Type<typeof EvalErrorEvent>;

export const SessionStartEvent = Schema.Struct({
  id: SessionID,
  trajMetrics: Schema.Array(Metric.Metadata),
});
export type SessionStartEvent = Schema.Schema.Type<typeof SessionStartEvent>;

export const SessionEndEvent = Schema.Struct({
  id: SessionID,
  reason: Response.FinishReason,
  usage: Schema.NullOr(Response.Usage),
});
export type SessionEndEvent = Schema.Schema.Type<typeof SessionEndEvent>;

export const SessionErrorEvent = Schema.Struct({
  id: SessionID,
  error: Schema.Defect(),
});
export type SessionErrorEvent = Schema.Schema.Type<typeof SessionErrorEvent>;

export const TrajMetricEvent = Schema.Struct({
  id: TrailID,
  metricID: Schema.String,
  points: Chart.Points,
});
export type TrajMetricEvent = Schema.Schema.Type<typeof TrajMetricEvent>;

export const TrajMetricErrorEvent = Schema.Struct({
  id: TrailID,
  metricID: Schema.String,
  error: Schema.Defect(),
});
export type TrajMetricErrorEvent = Schema.Schema.Type<typeof TrajMetricErrorEvent>;

export const TrailStartEvent = Schema.Struct({
  id: TrailID,
  schedMetrics: Schema.Array(Metric.Metadata),
});
export type TrailStartEvent = Schema.Schema.Type<typeof TrailStartEvent>;

export const TrailEndEvent = <G extends Schema.Constraint>(schema: G) =>
  Schema.Struct({
    id: TrailID,
    grade: schema,
  });
export type TrailEndEvent<G extends Schema.Constraint = any> = Readonly<{
  id: TrailID;
  grade: G;
}>;

export const TrailErrorEvent = Schema.Struct({
  id: TrailID,
  error: Schema.Defect(),
});
export type TrailErrorEvent = Schema.Schema.Type<typeof TrailErrorEvent>;

export const SchedMetricEvent = Schema.Struct({
  id: TrailID,
  metricID: Schema.String,
  points: Chart.Points,
});
export type SchedMetricEvent = Schema.Schema.Type<typeof SchedMetricEvent>;

export const SchedMetricErrorEvent = Schema.Struct({
  id: TrailID,
  metricID: Schema.String,
  error: Schema.Defect(),
});
export type SchedMetricErrorEvent = Schema.Schema.Type<typeof SchedMetricErrorEvent>;

export const TaskStartEvent = <S extends Schema.Constraint>(extraSchema: S) =>
  Schema.Struct({
    id: TaskID,
    metadata: Task.Metadata,
    extra: extraSchema,
  });
export type TaskStartEvent<S extends Schema.Constraint = any> = Readonly<{
  id: TaskID;
  metadata: Task.Metadata;
  extra: S;
}>;

export const TaskEndEvent = <S extends Schema.Constraint>(resultSchema: S) =>
  Schema.Struct({
    id: TaskID,
    result: resultSchema,
  });
export type TaskEndEvent<S extends Schema.Constraint = any> = Readonly<{
  id: TaskID;
  result: S;
}>;

export const TaskErrorEvent = Schema.Struct({
  id: TaskID,
  error: Schema.Defect(),
});
export type TaskErrorEvent = Schema.Schema.Type<typeof TaskErrorEvent>;

export const EvalEndEvent = <S extends Schema.Constraint>(resultSchema: S) =>
  Schema.Struct({
    id: EvalID,
    result: resultSchema,
  });
export type EvalEndEvent<S extends Schema.Constraint = any> = Readonly<{
  id: EvalID;
  result: S;
}>;
