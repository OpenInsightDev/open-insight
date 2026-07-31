import type { Effect } from "effect";
import type * as Task from "#/task/index.ts";

export type Tasks<T extends Task.Task = Task.Task> = ReadonlyArray<T>;

export type Load<T extends Task.Task = Task.Task, E = never, R = never> = Effect.Effect<
  Tasks<T>,
  E,
  R
>;

export type LoadFnReturn<T extends Task.Task = Task.Task, E = never, R = never> = Effect.fn.Return<
  Tasks<T>,
  E,
  R
>;

export * from "./error.ts";
export * from "./file.ts";
export * from "./dist.ts";
export * from "./git/index.ts";
export * from "./iter.ts";
export * from "./parquet.ts";
