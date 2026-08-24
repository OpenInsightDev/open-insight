import * as Task from "#/task/index.ts";
import * as Bench from "./bench.ts";
import { Data, Effect, Option, Schema } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Override } from "#/utils/type.ts";
import { TaskError } from "#/task/error.ts";
import { hasProperty } from "effect/Predicate";

export type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Readonly<{
  [K in keyof Tasks]: Task.Result.ResultOf<Tasks[K]>;
}>;
export type TaskResults = Readonly<Record<string, Task.Result.TaskResult>>;

export class BenchResult<S extends Schema.Constraint = any> extends Data.TaggedClass(
  "BenchResult",
)<{
  result: S["Type"];
}> {}

export type Exec = (taskResults: TaskResults) => Effect.Effect<BenchResult, TaskError>;
export type ExecOption<
  Tasks extends Record<string, Task.Any> = any,
  S extends Schema.Constraint = any,
> = BivariantFn<(taskResults: TaskResultsOf<Tasks>) => S["Type"] | PromiseLike<S["Type"]>>;

const makeExec = (exec: ExecOption): Exec =>
  Effect.fn(function* (taskResults) {
    const result = yield* Effect.tryPromise({
      try: () => Promise.resolve(exec(taskResults)),
      catch: TaskError.result,
    });
    return new BenchResult({ result });
  });

const Field: unique symbol = Symbol.for("BenchResultField");
export type Mixin<S extends Schema.Constraint> = Readonly<{
  [Field]: { schema: S; exec: Exec };
}>;
export type MixinOf<B> = B extends Mixin<infer S> ? Mixin<S>[typeof Field] : never;
export type ResultOf<B> = B extends Mixin<infer S> ? BenchResult<S> : never;

export const mixinOf = <T extends object>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as MixinOf<T>) : null);

export const result =
  <B extends Bench.Any, S extends Schema.Constraint>(
    schema: S,
    exec: ExecOption<Bench.TasksOf<B>, S>,
  ) =>
  (bench: B): Override<B, Mixin<S>> =>
    Object.assign(bench, { [Field]: { schema, exec: makeExec(exec) } });
