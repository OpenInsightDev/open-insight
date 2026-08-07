import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";
import { Effect, Equal, Schema } from "effect";
import { GradeError } from "./error.ts";
import type { Result, Results } from "./index.ts";

export type Context<Rs extends Results = never> = Sandbox.SandboxPromise &
  Readonly<{
    prevResults: UnionToIntersection<Rs>;
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends Result = Result, Rs extends Results = never> = BivariantFn<
  (ctx: Context<Rs>) => PromiseLike<R["Encoded"]>
>;

export type VerifExec = (
  options: Readonly<{
    trajectory: Prompt.Trajectory;
  }> &
    Sandbox.SandboxPromise,
) => PromiseLike<Prompt.RawInput | null>;
export type Verif<R extends Result = Result> = Readonly<{
  verif: VerifExec;
  expect: Partial<R["Encoded"]>;
}>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: R;
  grade: Exec<R, Rs>;
  verif?: Verif<R>;
}>;

export const make =
  <R extends Result>(schema: R) =>
  <Rs extends Results>(grade: Exec<R, Rs>, verif?: Verif<R>) => ({ schema, grade, verif });

export const isVerifiable = (
  grader: Grader,
): grader is Grader & Readonly<{ verif: NonNullable<Grader["verif"]> }> =>
  grader.verif !== undefined;

export const matches = <R extends Result>(
  schema: R,
  result: R["Encoded"],
  expect: Partial<R["Encoded"]>,
): Effect.Effect<boolean, GradeError, R["DecodingServices"]> =>
  Effect.all([
    Schema.decodeEffect(schema)(result),
    // Preserve dynamic result fields while overriding the stable fields declared by expect.
    Schema.decodeEffect(schema)({ ...result, ...expect }),
  ]).pipe(
    Effect.map(([actual, expected]) => Equal.equals(actual, expected)),
    Effect.mapError(GradeError.result),
  );
