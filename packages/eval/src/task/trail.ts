import type { Prompt, Response, Sandbox } from "@open-insight/core/internal";
import { Data, Effect, Option, type Schema, Function } from "effect";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "./task.ts";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/type.ts";
import { TaskError } from "./error.ts";

// export class SessionResult extends Data.TaggedClass("SessionResult")<{
//   trajectory: Prompt.Trajectory;
//   usage: Response.Usage | null;
// }> {}

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
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
