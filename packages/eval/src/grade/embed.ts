import { Sandbox } from "@open-insight/core/internal";

import { Effect, Schema } from "effect";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type Context = Sandbox.Sandbox;

export type Exec<Result extends Schema.Constraint = any, E = unknown, R = never> = (
  ctx: Context,
) => Effect.Effect<Result["Type"], E | Retry.Retry, R>;

export type Grader<Result extends Schema.Constraint = any> = Exec<Result, GradeError>;

export type Options<Result extends Schema.Constraint = any, E = unknown, R = never> = Readonly<{
  grade: Exec<Result, E, R>;
}>;

export const make = Effect.fn(function* <Result extends Schema.Constraint, E, R>({
  grade: gradeOption,
}: Options<Result, E, R>) {
  const ctx = yield* Effect.context<R>();

  const exec = ((context) =>
    gradeOption(context).pipe(
      Effect.mapError(GradeError.exec),
      Effect.provide(ctx),
    )) satisfies Exec<Result, GradeError>;

  return exec;
});
