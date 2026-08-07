import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { GradeError, Retry } from "./error.ts";
import { type Verif } from "./verif.ts";

export type Result = Schema.ConstraintCodec<unknown, object>;
export type Results = Record<string, Result["Type"]>;

export type Context<Rs extends Results = never> = Sandbox.SandboxPromise &
  Readonly<{
    prevResults: UnionToIntersection<Rs>;
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends Result = Result, Rs extends Results = never> = BivariantFn<
  (ctx: Context<Rs>) => PromiseLike<R["Encoded"]>
>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: R;
  grade: Exec<R, Rs>;
  verif: Verif<R> | null;
}>;

export const make =
  <R extends Result>(schema: R) =>
  <Rs extends Results>(grade: Exec<R, Rs>, verif?: Verif<R>) => ({ schema, grade, verif });

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
