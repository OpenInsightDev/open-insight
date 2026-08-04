import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { GradeError, Retry } from "./error.ts";

export type Result = Schema.ConstraintCodec<unknown, unknown>;
export type Results = Record<string, Result["Type"]>;

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
export type Verif = Readonly<{
  verif: VerifExec;
  expect: Result["Encoded"];
}>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: R;
  grade: Exec<R, Rs>;
  verif?: Verif;
}>;

export const make =
  <R extends Result>(schema: R) =>
  <Rs extends Results>(grade: Exec<R, Rs>, verif?: Verif) => ({ schema, grade, verif });

export const isVerifiable = (
  grader: Grader,
): grader is Grader & Readonly<{ verif: NonNullable<Grader["verif"]> }> =>
  grader.verif !== undefined;

export const run = <R extends Result, Rs extends Results>(grader: Grader<R, Rs>) =>
  Effect.fn(function* (
    ctx: Context<Rs>,
  ): Effect.fn.Return<R["Type"], GradeError | Retry, R["DecodingServices"]> {
    const result = yield* Effect.tryPromise({
      try: () => grader.grade(ctx),
      catch: (cause) => (cause instanceof Retry ? cause : GradeError.exec(cause)),
    });
    return yield* Schema.decodeEffect(grader.schema)(result).pipe(
      Effect.mapError(GradeError.result),
    );
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
export * as Sandbox from "./sandbox/index.ts";
