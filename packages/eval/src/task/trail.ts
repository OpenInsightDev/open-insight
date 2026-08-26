import type { Prompt, Response, Sandbox, Trajectory } from "@open-insight/core/internal";
import { Data, Effect, Option, type Schema, Function } from "effect";
import * as Task from "./task.ts";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/type.ts";
import { TaskError } from "./error.ts";

export type SessionResult = Readonly<{
  trajectory: Trajectory.Trajectory<any>;
  usage: Response.Usage | null;
}>;

export type GradedResult<G extends Schema.Constraint> = Array<SessionResult> &
  Readonly<{
    grade: G["Type"];
  }>;

export class TrailResult<
  G extends Schema.Constraint,
  S extends Schema.Constraint,
> extends Data.TaggedClass("TrailResult")<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
  result: S["Type"];
}> {}

export type FnOption<G extends Schema.Constraint, S extends Schema.Constraint> = (
  sessions: GradedResult<G>,
) => Effect.Effect<S["Type"], unknown, Sandbox.Current>;

export type Fn<G extends Schema.Constraint, S extends Schema.Constraint> = (
  sessions: GradedResult<G>,
) => Effect.Effect<TrailResult<G, S>, TaskError, Sandbox.Current>;

const Field: unique symbol = Symbol.for("ResultField");
export type Mixin<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  [Field]: ResultFn<G, S>;
}>;
