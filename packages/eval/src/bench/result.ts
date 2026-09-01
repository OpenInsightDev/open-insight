import * as Task from "#/task/index.ts";
import * as Bench from "./bench.ts";
import { BenchError } from "./error.ts";
import { Data, Effect, Option, Schema, flow } from "effect";
import type { Override } from "#/utils/type.ts";
import { hasProperty } from "effect/Predicate";

export type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Readonly<{
  [K in keyof Tasks]: Task.Result.TaskResultOf<Tasks[K]>;
}>;

export class BenchResult<S extends Schema.Constraint = any> extends Data.TaggedClass(
  "BenchResult",
)<{
  id: string;
  result: S["Type"];
}> {}

export type Fn<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = (
  tasks: TaskResultsOf<Tasks>,
) => Effect.Effect<BenchResult<S>, BenchError>;

export type Aggregator<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = Fn<
  Tasks,
  S
> &
  Readonly<{ schema: S }>;

export type Any = Aggregator<any, any>;

const Field: unique symbol = Symbol("Field");
export type Mixin<A extends Any> = Readonly<{ [Field]: A }>;

export type AggregatorOf<T> = T extends Mixin<infer A> ? A : never;
export type ResultOf<T> = T extends Mixin<infer A> ? BenchResult<A["schema"]> : never;

export type MixinOf<T> = T extends Mixin<infer A> ? Mixin<A>[typeof Field] : never;

export const aggregatorOf = <T>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as AggregatorOf<T>) : null);

export const mixinOf = <T extends object>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as MixinOf<T>) : null);

export const result =
  <B extends Bench.Any, S extends Schema.Constraint>(
    schema: S,
    fn: (tasks: TaskResultsOf<Bench.TasksOf<B>>) => Effect.Effect<S["Type"], unknown>,
  ) =>
  (bench: B): Override<B, Mixin<Aggregator<Bench.TasksOf<B>, S>>> => {
    const aggFn = flow(
      fn,
      Effect.map((result) => new BenchResult({ id: bench.id, result })),
      Effect.mapError(BenchError.result),
    ) satisfies Fn<Bench.TasksOf<B>, S>;

    return Object.assign(bench, { [Field]: Object.assign(aggFn, { schema }) });
  };
