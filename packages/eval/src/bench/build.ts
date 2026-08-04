import { Effect, Schema } from "effect";
import { BenchError } from "./error.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";

export class BaseMetadata extends Schema.Class<BaseMetadata>("BenchBaseMetadata")({
  id: Schema.String,
  subset: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
  extras: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
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

export type Options = BaseMetadataEncoded &
  Readonly<{
    metrics?: ReadonlyArray<Metric.Bench.Metric>;
  }>;

export const make = Effect.fn(function* <T extends Task.AnyTask, E, R>(
  id: string,
  load: Tasks.Load<T, E, R>,
  options: Omit<BaseMetadataEncoded, "id"> &
    Readonly<{
      metrics?: ReadonlyArray<Metric.Bench.Metric>;
    }> = {},
): Effect.fn.Return<Bench<T>, BenchError, R> {
  const { metrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(BaseMetadata)({ id, ...options }).pipe(
    Effect.mapError(BenchError.init),
  );
  const tasks = yield* load.pipe(Effect.mapError(BenchError.taskLoad));

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
