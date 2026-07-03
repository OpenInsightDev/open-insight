import type * as Task from "../task/index.ts";
import { Effect, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("BenchmarkMetadata")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String)),
  homepage: Schema.optional(Schema.String),
  registry: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(Schema.String)),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export type Benchmark<T extends Task.Task = Task.Task> = Metadata &
  Readonly<{
    tasks: Task.Tasks<T>;
  }>;

type Options<T extends Task.Task> = Metadata &
  Readonly<{
    tasks: Task.Tasks<T>;
  }>;

export const make = <T extends Task.Task>({ tasks, ...metadata }: Options<T>) =>
  Effect.succeed({
    ...metadata,
    tasks,
  } satisfies Benchmark<T>);
