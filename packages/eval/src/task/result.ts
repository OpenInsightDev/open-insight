import type { Prompt, Response } from "@open-insight/core/internal";
import { type Schema } from "effect";
import type { BivariantFn } from "../utils/variant.ts";

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailResult<G extends Schema.Constraint> = Readonly<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}>;

export type Exec<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trails: Array<TrailResult<G>>,
) => S["Type"];

export type Fn<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<Exec<G, S>> &
  Readonly<{ schema: S }>;

export const make = <G extends Schema.Constraint, S extends Schema.Constraint>(
  schema: S,
  exec: Exec<G, S>,
): Fn<G, S> => Object.assign(exec, { schema });
