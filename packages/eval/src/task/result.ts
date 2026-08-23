import type { Prompt, Response } from "@open-insight/core/internal";
import { type Schema } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "./task.ts";

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailResult<G extends Schema.Constraint = any> = Readonly<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}>;

export type TaskResult<S extends Schema.Constraint = any> = Readonly<{
  result: S["Type"];
}>;

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

export const resultOf = <G extends Schema.Constraint, S extends Schema.Constraint>(
  value: Mixin<G, S>,
) => value[Field];

export const result =
  <T extends Task.Any, S extends Schema.Constraint>(schema: S, exec: Exec<Task.GradeOf<T>, S>) =>
  (task: T): T & Mixin<Task.GradeOf<T>, S> =>
    Object.assign(task, { [Field]: { schema, exec } });
