import { Effect, Schema } from "effect";
import * as Task from "#/task/index.ts";
import * as Tasks from "#/tasks/index.ts";
import { immerable } from "immer";

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String)),
  homepage: Schema.optional(Schema.String),
  registry: Schema.optional(Schema.String),
  authors: Schema.optional(Schema.Array(Schema.String)),
  subset: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  tasks: Schema.Array(Task.Metadata),
}) {
  [immerable] = true;
}

type MetadataOptions = Omit<Schema.Codec.Encoded<typeof Metadata>, "tasks">;

export type Bench<T extends Task.Task = Task.Task> = Metadata &
  Readonly<{
    tasks: Tasks.Tasks<T>;
  }>;

type Options<T extends Task.Task> = MetadataOptions &
  Readonly<{
    loader: Tasks.Load<T>;
  }>;

export const make = Effect.fn(function* <T extends Task.Task>(options: Options<T>) {
  const { loader } = options;

  const tasks = yield* loader;
});
