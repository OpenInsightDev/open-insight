import { Data, Effect, Option, type Schema, Function } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "./task.ts";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/type.ts";
import { TaskError } from "./error.ts";
import type { Trajectory, Response } from "@open-insight/core/internal";

export class SessionResult extends Data.TaggedClass("SessionResult")<{
  trajectory: Trajectory.Trajectory<any>;
  usage: Response.Usage | null;
}> {}

export class TrailResult<G extends Schema.Constraint> extends Data.TaggedClass("TrailResult")<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}> {}

export class TaskResult<S extends Schema.Constraint = any> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type FnOptions<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<
  (trails: ReadonlyArray<TrailResult<G>>) => S["Type"] | PromiseLike<S["Type"]>
>;
export type Fn<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trails: ReadonlyArray<TrailResult<G>>,
) => Effect.Effect<TaskResult<S>, TaskError>;

const makeFn =
  <G extends Schema.Constraint, S extends Schema.Constraint>(
    id: string,
    fn: FnOptions<G, S>,
  ): Fn<G, S> =>
  (trails) =>
    Effect.tryPromise({
      try: () => Promise.resolve(fn(trails)),
      catch: TaskError.result,
    }).pipe(Effect.map((result) => new TaskResult({ id, result })));

export type ResultFn<G extends Schema.Constraint, S extends Schema.Constraint> = Fn<G, S> &
  Readonly<{
    schema: S;
  }>;

const Field: unique symbol = Symbol.for("ResultField");
export type Mixin<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  [Field]: ResultFn<G, S>;
}>;
export type FnOf<T> = T extends Mixin<infer G, infer S> ? ResultFn<G, S> : never;
export type TaskResultOf<T> = T extends Mixin<any, infer S> ? TaskResult<S> : never;

export const fnOf = <T>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as FnOf<T>) : null);

export const result: {
  <T extends Task.Any, S extends Schema.Constraint>(
    schema: S,
    fn: FnOptions<Task.GradeOf<T>, S>,
  ): (task: T) => Override<T, Mixin<Task.GradeOf<T>, S>>;
  <T extends Task.Any, S extends Schema.Constraint>(
    task: T,
    schema: S,
    fn: FnOptions<Task.GradeOf<T>, S>,
  ): Override<T, Mixin<Task.GradeOf<T>, S>>;
} = Function.dual(
  3,
  <T extends Task.Any, S extends Schema.Constraint>(
    task: T,
    schema: S,
    fn: FnOptions<Task.GradeOf<T>, S>,
  ): Override<T, Mixin<Task.GradeOf<T>, S>> =>
    Object.assign(task, { [Field]: Object.assign(makeFn(task.id, fn), { schema }) }),
);
