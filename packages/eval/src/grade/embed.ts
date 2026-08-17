import { Prompt, Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Scope } from "effect";
import { GradeError } from "./error.ts";
import { type Verif } from "./verif.ts";
import * as Retry from "./retry.ts";
import { type AnyResult } from "./result.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends AnyResult = AnyResult> = BivariantFn<
  (ctx: Context) => PromiseLike<R["Encoded"]>
>;

export type Grader<R extends AnyResult = AnyResult> = Readonly<{
  grade: Exec<R>;
  verif: Verif<R> | null;
}>;

export type MakeContextOptions = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Prompt.Trajectory;
}>;

export const makeContext = Effect.fn(function* ({
  sandbox,
  trajectory,
}: MakeContextOptions): Effect.fn.Return<Context, never, Scope.Scope> {
  const promise = yield* Sandbox.asPromise(sandbox);
  return { ...promise, trajectory };
});

export const run = <R extends AnyResult = AnyResult>(grader: Grader<R>) =>
  Effect.fn(function* (
    options: MakeContextOptions,
  ): Effect.fn.Return<R["Encoded"], GradeError | Retry.Retry, Scope.Scope> {
    const ctx = yield* makeContext(options);
    return yield* Effect.tryPromise({
      try: () => grader.grade(ctx),
      catch: Retry.mapError,
    });
  }, Effect.scoped);
