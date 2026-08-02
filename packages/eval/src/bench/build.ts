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

export type Bench<T extends Task.AnyTask = Task.AnyTask> = Readonly<{
  metadata: BaseMetadata;
  tasks: Tasks.Tasks<T>;
  metrics: ReadonlyArray<Metric.Bench.Metric>;
}> & { _T?: T };

type Options<T extends Task.AnyTask, E, R> = BaseMetadataEncoded &
  Readonly<{
    tasks: Tasks.Load<T, E, R>;
    metrics?: ReadonlyArray<Metric.Bench.Metric>;
  }>;

export const make = Effect.fn(function* <T extends Task.AnyTask, E, R>(options: Options<T, E, R>) {
  const { tasks: load, metrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)(options).pipe();

  return {
    metadata,
    tasks: yield* load,
    metrics,
  } satisfies Bench<T>;
});

export const metadata = (bench: Bench): Metadata =>
  Metadata.make(
    {
      base: bench.metadata,
      tasks: bench.tasks.map((task) =>
        Task.Metadata.make({
          base: task.metadata,
          stages: task.stages.map((stage) => stage.metadata),
          extras: {},
        }),
      ),
    },
    { parseOptions: { onExcessProperty: "ignore" } },
  );
