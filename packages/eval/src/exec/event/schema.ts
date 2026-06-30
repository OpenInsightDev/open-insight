import { Schema, type Stream } from "effect";
import * as Metric from "../../metric/index.ts";
import type { ExecError } from "../error.ts";
import { Response, Toolkit } from "effect/unstable/ai";

export const EventSchema = Schema.TaggedUnion({
  TrajMetric: {
    benchmark: Schema.String,
    task: Schema.String,
    trail: Schema.Number,
    output: Metric.TrajOutput,
  },
  Message: {
    benchmark: Schema.String,
    task: Schema.String,
    trail: Schema.Number,
    part: Response.StreamPart(Toolkit.empty),
  },
  TaskMetric: {
    benchmark: Schema.String,
    task: Schema.String,
    output: Metric.TaskOutput,
  },
  BenchmarkMetric: {
    benchmark: Schema.String,
    output: Metric.BenchOutput,
  },
});

export type Event = Schema.Schema.Type<typeof EventSchema>;
export type EventStream = Stream.Stream<Event, ExecError>;
