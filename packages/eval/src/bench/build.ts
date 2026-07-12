import type * as Task from "../task/index.ts";
import { Effect, Schema } from "effect";
import { immerable } from "immer";

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  name: Schema.String,
  subset: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  description: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String)),
  homepage: Schema.optional(Schema.String),
  registry: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(Schema.String)),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {
  [immerable] = true;
}

export type Bench<T extends Task.Task = Task.Task> = Metadata &
  Readonly<{
    tasks: Task.Tasks<T>;
  }>;

type Options<T extends Task.Task> = Parameters<typeof Metadata.make>[0] &
  Readonly<{
    tasks: Task.Tasks<T>;
  }>;

export const make = <T extends Task.Task>({ tasks, ...metadata }: Options<T>) =>
  Effect.succeed(Object.assign(Metadata.make(metadata), { tasks }) satisfies Bench<T>);
