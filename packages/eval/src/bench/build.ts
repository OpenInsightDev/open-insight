import { Effect, Schema } from "effect";
import * as Task from "#/task/index.ts";
import * as Tasks from "#/tasks/index.ts";

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  subset: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  tasks: Schema.Array(Task.Metadata),
}) {}

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
