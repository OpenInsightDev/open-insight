import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { GradeError, Retry } from "./error.ts";
import { type Verif } from "./verif.ts";

export type AnyResult = Schema.ConstraintCodec<unknown, object>;

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends AnyResult = AnyResult> = BivariantFn<(ctx: Context) => PromiseLike<R>>;

export type Grader<R extends AnyResult = AnyResult> = Readonly<{
  schema: R;
  grade: Exec<R>;
  verif: Verif<R> | null;
}>;

export const make =
  <R extends AnyResult>(schema: R) =>
  (grade: Exec<R>, verif?: Verif<R>) => ({ schema, grade, verif });

export const run = <R extends AnyResult>(grader: Grader<R>) =>
  Effect.fn(function* (
    ctx: Context,
  ): Effect.fn.Return<R["Type"], GradeError | Retry, R["DecodingServices"]> {
    const result = yield* Effect.tryPromise({
      try: () => grader.grade(ctx),
      catch: (cause) => (cause instanceof Retry ? cause : GradeError.exec(cause)),
    });
    return yield* Schema.decodeEffect(grader.schema)(result).pipe(
      Effect.mapError(GradeError.result),
    );
  });
