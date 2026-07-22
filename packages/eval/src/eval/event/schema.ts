import { Schema, Stream } from "effect";
import * as Grade from "#/grade/index.ts";
import type { Error } from "../error.ts";
import * as Task from "#/task/index.ts";
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
  harness: Schema.String,
};

const StageFields = {
  ...TrailFields,
  stage: Schema.String,
};

export class InitEvent extends Schema.TaggedClass<InitEvent>()("InitEvent", {
  ...EvalFields,
  tasks: Schema.Array(Task.Metadata),
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

export class TrailScheduleEvent extends Schema.TaggedClass<TrailScheduleEvent>()(
  "TrailScheduleEvent",
  {
    ...TrailFields,
    op: ScheduleOpSchema,
  },
) {}

// TODO 在该事件中包含完成该 stage 时，trajectory 所报告的所有 metadata 信息，比如 context 长度、用时等等
export class TrailStagedEvent extends Schema.TaggedClass<TrailStagedEvent>()("TrailStagedEvent", {
  ...StageFields,
  grade: Grade.Result,
}) {}

export const StreamPart = Response.StreamPart(Toolkit.empty);
export type StreamPart = typeof StreamPart.Type;
export type StreamPartEncoded = typeof StreamPart.Encoded;

export class TrailStreamEvent extends Schema.TaggedClass<TrailStreamEvent>()("TrailStreamEvent", {
  ...TrailFields,
  parts: Schema.Array(StreamPart),
}) {}

export const Event = Schema.Union([
  InitEvent,
  TrailScheduleEvent,
  TrailStreamEvent,
  TrailStagedEvent,
]);
export type Event = Schema.Schema.Type<typeof Event>;

export type EventStream = Stream.Stream<Event, Error>;
