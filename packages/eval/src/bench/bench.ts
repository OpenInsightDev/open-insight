import * as Task from "#/task/index.ts";
import type { IndexByKey } from "#/utils/type.ts";
import { Data, Schema } from "effect";

export class Metadata extends Schema.Class<Metadata>("BenchMetadata")({
  id: Schema.String,
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  description: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}
export type MetadataEncoded = Schema.Codec.Encoded<typeof Metadata>;

export class Bench<ID extends string, Tasks extends Record<string, Task.Any>> extends Data.Class<{
  id: ID;
  metadata: Metadata;
  tasks: Tasks;
}> {}
export type IDOf<B> = B extends Bench<infer ID, any> ? ID : never;
export type TasksOf<B> = B extends Bench<any, infer Tasks> ? Tasks : never;

export type Any = Bench<string, Record<string, Task.Any>>;

type Options<ID extends string> = Omit<MetadataEncoded, "id"> & Readonly<{ id: ID }>;
export const fromArray = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  options: Options<ID>,
  tasks: Tasks,
): Bench<ID, IndexByKey<Tasks, "id">> => {
  const metadata = Schema.decodeSync(Metadata)(options);
  return new Bench({
    id: options.id,
    metadata,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
  });
};

export const make = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  options: Options<ID>,
  ...tasks: Tasks
): Bench<ID, IndexByKey<Tasks, "id">> => fromArray(options, tasks);
