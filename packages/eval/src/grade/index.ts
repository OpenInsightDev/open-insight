import type { Prompt, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { Error } from "./error.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

// grade result must be json serializable
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Result = Schema.Schema.Type<typeof Result>;

export type Grader<R extends Result> = Bivariant<(ctx: Context) => PromiseLike<R>>;

/**
 * Run a collection of graders with the given context.
 */
export const run = <R extends Result>(grader: Grader<R>) =>
  Effect.fn(function* (ctx: Context): Effect.fn.Return<R, Error> {
    const result = yield* Effect.tryPromise(() => grader(ctx)).pipe(Effect.mapError(Error.exec));
    const decoded = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
      Effect.mapError(Error.result),
    );
    return decoded as R;
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
