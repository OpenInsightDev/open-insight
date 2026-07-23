import type { Effect, Scope } from "effect";
import type * as Task from "#/task/index.ts";

export type Load<T extends Task.Task = Task.Task, E = never, R = never> = Effect.Effect<
  ReadonlyArray<T>,
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
