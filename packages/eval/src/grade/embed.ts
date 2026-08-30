import { Trajectory, Sandbox } from "@open-insight/core/internal";

import { Effect, Schema } from "effect";
import * as Retry from "./retry.ts";
import type { Tool } from "effect/unstable/ai";
import { GradeError } from "./error.ts";

export type Context<Tools extends Record<string, Tool.Any>> = Sandbox.Sandbox &
  Readonly<{
    trajectory: Trajectory.Trajectory<Tools>;
  }>;

export type Exec<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
  E = unknown,
  R = never,
> = (ctx: Context<Tools>) => Effect.Effect<Result["Type"], E | Retry.Retry, R>;

export type Grader<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
> = Exec<Result, Tools, GradeError>;

export type Options<
  Result extends Schema.Constraint = any,
  Tools extends Record<string, Tool.Any> = any,
  E = unknown,
  R = never,
> = Readonly<{
  grade: Exec<Result, Tools, E, R>;
}>;

export const make = Effect.fn(function* <
  Result extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  E,
  R,
>({ grade: gradeOption }: Options<Result, Tools, E, R>) {
  const ctx = yield* Effect.context<R>();

  const exec = ((context) =>
    gradeOption(context).pipe(
      Effect.mapError(GradeError.exec),
      Effect.provide(ctx),
    )) satisfies Exec<Result, Tools, GradeError>;

  return exec;
});
