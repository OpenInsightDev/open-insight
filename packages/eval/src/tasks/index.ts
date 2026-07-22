import type { Effect, Scope } from "effect";
import type * as Task from "#/task/index.ts";
import type { Error } from "./error.ts";

export type Tasks<T extends Task.Task = Task.Task> = ReadonlyArray<T>;
export type Load<T extends Task.Task = Task.Task> = Effect.Effect<Tasks<T>, Error, Scope.Scope>;

export * from "./error.ts";
export * from "./file.ts";
export * from "./dist.ts";
export * from "./git.ts";
export * from "./parquet.ts";
export * from "./iter.ts";
export * from "./harbor/index.ts";
