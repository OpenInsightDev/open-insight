import { Effect, Schema } from "effect";
import * as BenchMetric from "#/metric/bench.ts";
import * as Task from "#/task/index.ts";
import type * as Tasks from "#/tasks/index.ts";

export class BaseMetadata extends Schema.Class<BaseMetadata>("BenchBaseMetadata")({
  subset: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  base: BaseMetadata,
  tasks: Schema.Array(Task.Metadata),
}) {}

export type Bench<T extends Task.Task = Task.Task> = BaseMetadata &
  Readonly<{
    tasks: ReadonlyArray<T>;
    metrics: ReadonlyArray<BenchMetric.Metric>;
  }>;

type Options<T extends Task.Task> = BaseMetadataEncoded &
  Readonly<{
    load: Tasks.Load<T>;
  }>;

export const make = Effect.fn(function* <T extends Task.Task>(options: Options<T>) {
  const { load } = options;

  const tasks = yield* load;
});

export const metadata = (bench: Bench): Metadata =>
  Metadata.make({
    base: bench,
    tasks: bench.tasks.map(Task.metadata),
  });
