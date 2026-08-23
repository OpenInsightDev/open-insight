import * as Task from "#/task/index.ts";
import type { Schema } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Bench } from "./bench.ts";

export type ResultsOf<Tasks extends Record<string, Task.Any>> = {
  [K in keyof Tasks]: Task.Result.ResultOf<Tasks[K]>;
};

export type BenchResult<S extends Schema.Constraint = any> = Readonly<{
  result: S["Type"];
}>;

export type Exec<
  Tasks extends Record<string, Task.Any>,
  S extends Schema.Constraint = any,
> = BivariantFn<(tasks: ResultsOf<Tasks>) => BenchResult<S> | PromiseLike<BenchResult<S>>>;

const Field: unique symbol = Symbol.for("BenchResultField");
export type Mixin<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = Readonly<{
  [Field]: {
    schema: S;
    exec: Exec<Tasks, S>;
  };
}>;
export type ResultOf<B> = B extends Mixin<any, infer S> ? S["Type"] : never;

export const resultOf = <Tasks extends Record<string, Task.Any>, S extends Schema.Constraint>(
  value: Mixin<Tasks, S>,
) => value[Field];

export const result =
  <Tasks extends Record<string, Task.Any>, S extends Schema.Constraint>(
    schema: S,
    exec: Exec<Tasks, S>,
  ) =>
  (bench: Bench<Tasks>): Bench<Tasks> & Mixin<Tasks, S> =>
    Object.assign(bench, { [Field]: { schema, exec } });
