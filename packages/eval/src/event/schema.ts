import { Schema } from "effect";
import * as Task from "#/task/index.ts";
import * as Metric from "#/metric/index.ts";
import { Prompt, Response } from "@open-insight/core/internal";
import { Toolkit } from "effect/unstable/ai";

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
  trailIdx: Schema.Number,
});
export type TrailID = Schema.Schema.Type<typeof TrailID>;

export const SessionID = Schema.Struct({
  ...TrailID.fields,
  sessionIdx: Schema.Number,
});
export type SessionID = Schema.Schema.Type<typeof SessionID>;

export class SessionStartEvent extends Schema.TaggedClass<SessionStartEvent>()(
  "SessionStartEvent",
  {
    id: SessionID,
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
    part: Response.Part(Toolkit.empty),
  },
) {}

export class SessionRetryEvent extends Schema.TaggedClass<SessionRetryEvent>()(
  "SessionRetryEvent",
  {
    id: SessionID,
    reason: Schema.NullOr(Schema.String),
  },
) {}

export class SessionEndEvent extends Schema.TaggedClass<SessionEndEvent>()("SessionEndEvent", {
  id: SessionID,
  usage: Schema.NullOr(Response.Usage),
  reason: Response.FinishReason,
}) {}

export class SessionErrorEvent extends Schema.TaggedClass<SessionErrorEvent>()(
  "SessionErrorEvent",
  {
    id: SessionID,
    error: Schema.Defect(),
  },
) {}

export class TrailStartEvent extends Schema.TaggedClass<TrailStartEvent>()("TrailStartEvent", {
  id: TrailID,
  schedMetrics: Schema.Array(Metric.Metadata),
}) {}

export class TrailEndEvent extends Schema.TaggedClass<TrailEndEvent>()("TrailEndEvent", {
  id: TrailID,
  grade: Schema.Unknown,
}) {}

export class TrailErrorEvent extends Schema.TaggedClass<TrailErrorEvent>()("TrailErrorEvent", {
  id: TrailID,
  error: Schema.Defect(),
}) {}

export class TaskStartEvent extends Schema.TaggedClass<TaskStartEvent>()("TaskStartEvent", {
  id: TaskID,
  task: Task.Metadata,
}) {}

export class TaskEndEvent extends Schema.TaggedClass<TaskEndEvent>()("TaskEndEvent", {
  id: TaskID,
}) {}

export class TaskErrorEvent extends Schema.TaggedClass<TaskErrorEvent>()("TaskErrorEvent", {
  id: TaskID,
  error: Schema.Defect(),
}) {}
