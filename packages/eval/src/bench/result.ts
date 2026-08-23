import * as Task from "#/task/index.ts";
import * as Bench from "./bench.ts";
import type { Schema } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Override } from "#/utils/type.ts";

export type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Readonly<{
  [K in keyof Tasks]: Task.Result.ResultOf<Tasks[K]> & { _tag: K };
}>;

export type BenchResult<S extends Schema.Constraint = any> = Readonly<S["Type"]>;

export type Exec<
  Tasks extends Record<string, Task.Any>,
  S extends Schema.Constraint = any,
> = BivariantFn<
  (taskResults: TaskResultsOf<Tasks>) => BenchResult<S> | PromiseLike<BenchResult<S>>
>;

const Field: unique symbol = Symbol.for("BenchResultField");
export type Mixin<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = Readonly<{
  [Field]: { schema: S; exec: Exec<Tasks, S> };
}>;
export type ResultOf<B> = B extends Mixin<any, infer S> ? S["Type"] : never;

export const resultOf = <Tasks extends Record<string, Task.Any>, S extends Schema.Constraint>(
  value: Mixin<Tasks, S>,
) => value[Field];

export const result =
  <B extends Bench.Any, S extends Schema.Constraint>(schema: S, exec: Exec<Bench.TasksOf<B>, S>) =>
  (bench: B): Override<B, Mixin<Bench.TasksOf<B>, S>> =>
    Object.assign(bench, { [Field]: { schema, exec } });
