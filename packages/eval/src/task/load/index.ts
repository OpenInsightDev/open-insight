import type { Effect, Scope } from "effect";
import type * as Task from "../index.ts";
import type { TaskError } from "../error.ts";

export type Tasks<T extends Task.Task = Task.Task> = ReadonlyArray<
  Effect.Effect<T, TaskError, Scope.Scope>
>;
export type Loader<T extends Task.Task = Task.Task, R = never, E = TaskError> = Effect.Effect<
  Tasks<T>,
  E,
  R | Scope.Scope
>;

export * from "./file.ts";
export * from "./dist.ts";
export * from "./git.ts";
export * from "./parquet.ts";
export * from "./select.ts";
export * from "./iter.ts";
export * from "./harbor/index.ts";
