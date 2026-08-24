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
