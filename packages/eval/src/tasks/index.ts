import type { Effect, Scope } from "effect";
import type * as Task from "#/task/index.ts";
import type { Error } from "./error.ts";

export type Tasks<T extends Task.Task = Task.Task> = ReadonlyArray<Effect.Effect<T, Error>>;
export type Loader<T extends Task.Task = Task.Task, R = never, E = Error> = Effect.Effect<
  Tasks<T>,
  E,
  R | Scope.Scope
>;

export * from "./error.ts";
export * from "./file.ts";
export * from "./dist.ts";
export * from "./git.ts";
export * from "./parquet.ts";
export * from "./iter.ts";
export * from "./harbor/index.ts";
