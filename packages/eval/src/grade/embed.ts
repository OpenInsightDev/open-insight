import { Trajectory, Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Scope } from "effect";
import { GradeError } from "./error.ts";
import { type Verif } from "./verif.ts";
import * as Retry from "./retry.ts";
import type { Tool } from "effect/unstable/ai";

export type Context<Tools extends Record<string, Tool.Any>> = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Trajectory.Trajectory<Tools>;
  }>;

export type Exec<
  Tools extends Record<string, Tool.Any>,
  R extends Schema.Constraint = any,
> = BivariantFn<(ctx: Context<Tools>) => PromiseLike<R["Type"]>>;

export type Grader<
  Tools extends Record<string, Tool.Any>,
  R extends Schema.Constraint = any,
> = Readonly<{
  grade: Exec<Tools, R>;
  verif: Verif<R> | null;
}>;

// export type MakeContextOptions<Tools extends Record<string, Tool.Any>> = Readonly<{
//   sandbox: Sandbox.Sandbox;
//   trajectory: Trajectory.Trajectory<Tools>;
// }>;

type Options<Tools extends Record<string, Tool.Any>> = Readonly<{
  sandbox: Sandbox.Sandbox;
  trajectory: Trajectory.Trajectory<Tools>;
}>;

export const makeContext = Effect.fn(function* ({
  sandbox,
  trajectory,
}: MakeContextOptions): Effect.fn.Return<Context, never, Scope.Scope> {
  const promise = yield* Sandbox.asPromise(sandbox);
  return { ...promise, trajectory };
});

export const run = <R extends Schema.Constraint = any>(grader: Grader<R>) =>
  Effect.fn(function* (
    options: MakeContextOptions,
  ): Effect.fn.Return<R["Type"], GradeError | Retry.Retry, Scope.Scope> {
    const ctx = yield* makeContext(options).pipe(Effect.scoped);
    return yield* Effect.tryPromise({
      try: () => grader.grade(ctx),
      catch: Retry.mapError,
    });
  });
