import type { Prompt, Response } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Effect, type Schema } from "effect";
import type { BivariantFn } from "../utils/variant.ts";
import * as Task from "./build.ts";

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailResult<G extends Schema.Constraint> = Readonly<{
  usage: Response.Usage | null;
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
  <G extends Schema.Constraint, S extends Schema.Constraint>(schema: S, exec: Exec<G, S>) =>
  <T extends Task.Any, E, R>(
    task: Effect.Effect<T, E, R> & Grade.Mixin<G>,
  ): Effect.Effect<T & Mixin<G, S>, E, R> =>
    Effect.map(task, (t) => Object.assign(t, { [Field]: make(schema, exec) }));
