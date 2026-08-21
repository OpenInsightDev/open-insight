import type { Prompt, Response } from "@open-insight/core/internal";
import { Effect, type Schema } from "effect";
import type { BivariantFn } from "../utils/variant.ts";
import * as Task from "./build.ts";

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailResult<G extends Schema.Constraint> = Readonly<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}>;

type Exec<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trails: Array<TrailResult<G>>,
) => S["Type"];

export type Fn<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<Exec<G, S>> &
  Readonly<{ schema: S }>;

export const make = <G extends Schema.Constraint, S extends Schema.Constraint>(
  schema: S,
  exec: Exec<G, S>,
): Fn<G, S> => Object.assign(exec, { schema });

export const Field = "#/task/result" as const;
export type Mixin<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  [Field]: Fn<G, S>;
}>;

export const result =
  <S extends Schema.Constraint, T extends Task.Any>(schema: S) =>
  (exec: Exec<Task.GradeOf<T>, S>) =>
  <E, R>(task: Effect.Effect<T, E, R>): Effect.Effect<T & Mixin<Task.GradeOf<T>, S>, E, R> =>
    Effect.map(task, (task) => Object.assign(task, { [Field]: make(schema, exec) }));

export type ResultOf<T> = T extends Mixin<infer _, infer S> ? S : never;
export type ResultsOf<T extends Record<string, any>> = {
  [K in keyof T]: ResultOf<T[K]>;
};
export type ResultFnOf<T> = T extends Mixin<infer G, infer S> ? Fn<G, S> : never;
