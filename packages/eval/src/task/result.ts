import type { Prompt, Response } from "@open-insight/core/internal";
import { Data, Option, type Schema } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "./task.ts";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/type.ts";

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

export type TaskResult<S extends Schema.Constraint = any> = Readonly<S["Type"]>;

export type Exec<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<
  (trails: Array<TrailResult<G>>) => TaskResult<S> | PromiseLike<TaskResult<S>>
>;

const Field: unique symbol = Symbol.for("ResultField");
export type Mixin<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  [Field]: {
    schema: S;
    exec: Exec<G, S>;
  };
}>;
export type ResultOf<T> = T extends Mixin<any, infer S> ? S["Type"] : never;

export const hasResult = <T, G extends Schema.Constraint, S extends Schema.Constraint>(
  value: T,
): value is T & Mixin<G, S> => hasProperty(value, Field);

export const resultOf = <T, G extends Schema.Constraint, S extends Schema.Constraint>(value: T) =>
  hasResult<T, G, S>(value) ? Option.some(value[Field]) : Option.none();

export const result =
  <T extends Task.Any, S extends Schema.Constraint>(schema: S, exec: Exec<Task.GradeOf<T>, S>) =>
  (task: T): Override<T, Mixin<Task.GradeOf<T>, S>> =>
    Object.assign(task, { [Field]: { schema, exec } });
