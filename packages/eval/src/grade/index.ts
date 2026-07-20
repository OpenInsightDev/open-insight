import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import { Effect, Equal, Schema } from "effect";
import { Error } from "./error.ts";
import { isFunction } from "effect/Predicate";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

// grade result must be json serializable
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Result = Schema.Schema.Type<typeof Result>;

type Verifier = (sandbox: Sandbox.SandboxPromise) => PromiseLike<Prompt.Trajectory | null>;

export type BaseGrader<R extends Result = Result> = Bivariant<(ctx: Context) => PromiseLike<R>>;
export type VerifGrader<R extends Result = Result> = Readonly<{
  verify: Verifier;
  exec: BaseGrader<R>;
  expect: R;
}>;

export type Grader<R extends Result> = BaseGrader<R> | VerifGrader<R>;

export const run = <R extends Result>(grader: Grader<R>) =>
  Effect.fn(function* (ctx: Context): Effect.fn.Return<R, Error> {
    const exec = isFunction(grader) ? grader : grader.exec;
    const result = yield* Effect.tryPromise({
      try: () => exec(ctx),
      catch: (cause) => {
        if (Prompt.isMessage(cause)) {
          if (cause.role !== "user") {
            return Error.exec(new globalThis.Error(`Expect a UserMessage, got ${cause.role}`));
          }
          return Error.retry(cause);
        }
        return Error.exec(cause);
      },
    });
    const decoded = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
      Effect.mapError(Error.result),
    );
    return decoded as R;
  });

export const verify = ({ verify, exec, expect }: VerifGrader) =>
  Effect.fn(function* (sandbox: Sandbox.SandboxPromise): Effect.fn.Return<boolean, Error> {
    const trajectory = yield* Effect.tryPromise(() => verify(sandbox)).pipe(
      Effect.mapError(Error.verify),
    );
    const result = yield* run(exec)({ ...sandbox, trajectory: trajectory ?? Prompt.empty });
    return Equal.equals(result, expect);
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
