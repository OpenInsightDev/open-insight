import { Effect, Schema } from "effect";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";
import * as Tasks from "#/tasks/index.ts";

export class BaseMetadata extends Schema.Class<BaseMetadata>("BenchBaseMetadata")({
  id: Schema.String,
  subset: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  extras: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
}) {}
type BaseMetadataEncoded = Schema.Codec.Encoded<typeof BaseMetadata>;

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  base: BaseMetadata,
  tasks: Schema.Array(Task.Metadata),
}) {}

export type Bench<T extends Task.Task = Task.Task> = Readonly<{
  metadata: BaseMetadata;
  tasks: Tasks.Tasks<T>;
  metrics: ReadonlyArray<Metric.Bench.Metric>;
}> & { _T?: T };

type Options<T extends Task.Task> = BaseMetadataEncoded &
  Readonly<{
    tasks: Tasks.Tasks<T>;
    metrics?: ReadonlyArray<Metric.Bench.Metric>;
  }>;

export const make = Effect.fn(function* <T extends Task.Task>(options: Options<T>) {
  const { tasks, metrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe();

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
