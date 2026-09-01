import { Sandbox } from "@open-insight/core/internal";

import { Effect, Schema } from "effect";
import * as Retry from "./retry.ts";
import { GradeError } from "./error.ts";

export type Context = Sandbox.Sandbox;

export type Exec<Result extends Schema.Constraint = any> = (
  ctx: Context,
) => Effect.Effect<Result["Type"], GradeError | Retry.Retry>;

export type Grader<Result extends Schema.Constraint = any> = Exec<Result>;

export type Options<Result extends Schema.Constraint = any> = Readonly<{
  grade: (ctx: Context) => Effect.Effect<Result["Type"], unknown | Retry.Retry>;
}>;

export const make = <Result extends Schema.Constraint>({ grade: gradeOption }: Options<Result>) => {
  return (context: Context) =>
    gradeOption(context).pipe(
      Effect.mapError((err) => (err instanceof Retry.Retry ? err : GradeError.exec(err))),
    );
};
