import { Effect, Schema } from "effect";
import * as BenchMetric from "#/metric/bench.ts";
import * as Task from "#/task/index.ts";
import type * as Tasks from "#/tasks/index.ts";

export class BaseMetadata extends Schema.Class<BaseMetadata>("BenchBaseMetadata")({
  id: Schema.String,
  subset: Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false))),
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  base: BaseMetadata,
  tasks: Schema.Array(Task.Metadata),
}) {}

export type Bench<T extends Task.Task = Task.Task> = Readonly<{
  metadata: BaseMetadata;
  tasks: ReadonlyArray<T>;
  metrics: ReadonlyArray<BenchMetric.Metric>;
}> & { _T?: T };

type Options<T extends Task.Task> = BaseMetadataEncoded &
  Readonly<{
    tasks: Tasks.Load<T>;
    metrics?: ReadonlyArray<BenchMetric.Options>;
  }>;

export const make = Effect.fn(function* <T extends Task.Task>(options: Options<T>) {
  const { tasks: load, metrics: metricOptions = [] } = options;
  const tasks = yield* load;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe();
  const metrics = yield* Effect.all(metricOptions.map(BenchMetric.make));

  return {
    metadata,
    tasks,
    metrics,
  } satisfies Bench<T>;
});

export const metadata = (bench: Bench): Metadata =>
  Metadata.make(
    {
      base: bench.metadata,
      tasks: bench.tasks.map(Task.metadata),
    },
    { parseOptions: { onExcessProperty: "ignore" } },
  );
