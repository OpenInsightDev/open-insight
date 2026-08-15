import { Effect, Schema } from "effect";
import { BenchError } from "./error.ts";
import * as Tasks from "#/tasks/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Task from "#/task/index.ts";

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  id: Schema.String,
  subset: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false), { encodingStrategy: "omit" }),
  ),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export type Bench<T extends Task.AnyTask = Task.AnyTask> = Readonly<{
  metadata: Metadata;
  tasks: Tasks.Tasks<T>;
  metrics: ReadonlyArray<Metric.Bench.Metric>;
}> & { _T?: T };

export type Options = MetadataEncoded &
  Readonly<{
    metrics?: ReadonlyArray<Metric.Bench.Metric>;
  }>;

export const make = Effect.fn(function* <T extends Task.AnyTask, E, R>(
  id: string,
  load: Tasks.Load<T, E, R>,
  options: Omit<MetadataEncoded, "id"> &
    Readonly<{
      metrics?: ReadonlyArray<Metric.Bench.Metric>;
    }> = {},
): Effect.fn.Return<Bench<T>, BenchError, R> {
  const { metrics = [] } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)({ id, ...options }).pipe(
    Effect.mapError(BenchError.init),
  );
  const tasks = yield* load.pipe(Effect.mapError(BenchError.taskLoad));

  return {
    metadata,
    tasks,
    metrics,
  } satisfies Bench<T>;
});
