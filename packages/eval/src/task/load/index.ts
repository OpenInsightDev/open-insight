import type { Effect, Scope } from "effect";
import type * as Task from "../index.ts";
import type { TaskError } from "../error.ts";

export type Tasks<T extends Task.Task = Task.Task> = ReadonlyArray<Effect.Effect<T, TaskError>>;

export type Loader<T extends Task.Task = Task.Task, R = never, E = TaskError> = Effect.Effect<
  Tasks<T>,
  E,
  R | Scope.Scope
>;

export * as File from "./file.ts";
export * as Git from "./git.ts";
export * from "./iter.ts";
