import type { Prompt, Response } from "@open-insight/core/internal";
import { Data, Effect, Option, type Schema, Function } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "./task.ts";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/type.ts";
import { TaskError } from "./error.ts";

export class SessionResult extends Data.TaggedClass("SessionResult")<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}> {}

export class TrailResult<G extends Schema.Constraint = any> extends Data.TaggedClass(
  "TrailResult",
)<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}> {}

export class TaskResult<S extends Schema.Constraint = any> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type ExecOption<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<
  (trails: ReadonlyArray<TrailResult<G>>) => S["Type"] | PromiseLike<S["Type"]>
>;
export type Exec<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trails: ReadonlyArray<TrailResult<G>>,
) => Effect.Effect<TaskResult<S>, TaskError>;

const makeExec = <G extends Schema.Constraint, S extends Schema.Constraint>(
  id: string,
  exec: ExecOption<G, S>,
): Exec<G, S> =>
  Effect.fn(function* (trails) {
    const result = yield* Effect.tryPromise({
      try: () => Promise.resolve(exec(trails)),
      catch: TaskError.result,
    });
    return new TaskResult({ id, result });
  });

const Field: unique symbol = Symbol.for("ResultField");
export type Mixin<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  [Field]: {
    schema: S;
    exec: Exec<G, S>;
  };
}>;
export type MixinOf<T> = T extends Mixin<infer G, infer S> ? Mixin<G, S>[typeof Field] : never;
export type ResultOf<T> = T extends Mixin<any, infer S> ? TaskResult<S> : never;

export const mixinOf = <T extends object>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as MixinOf<T>) : null);

export const result: {
  <T extends Task.Any, S extends Schema.Constraint>(
    schema: S,
    exec: ExecOption<Task.GradeOf<T>, S>,
  ): (task: T) => Override<T, Mixin<Task.GradeOf<T>, S>>;
  <T extends Task.Any, S extends Schema.Constraint>(
    task: T,
    schema: S,
    exec: ExecOption<Task.GradeOf<T>, S>,
  ): Override<T, Mixin<Task.GradeOf<T>, S>>;
} = Function.dual(
  3,
  <T extends Task.Any, S extends Schema.Constraint>(
    task: T,
    schema: S,
    exec: ExecOption<Task.GradeOf<T>, S>,
  ): Override<T, Mixin<Task.GradeOf<T>, S>> =>
    Object.assign(task, { [Field]: { schema, exec: makeExec(task.id, exec) } }),
);
