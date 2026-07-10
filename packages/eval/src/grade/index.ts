import type { Prompt, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { TaskError } from "../task/error.ts";

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
  Effect.fn(function* (ctx: Context): Effect.fn.Return<R, TaskError> {
    const result = yield* Effect.tryPromise(() => grader(ctx)).pipe(
      Effect.mapError(TaskError.gradeExec),
    );
    const decoded = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
      Effect.mapError(TaskError.gradeResult),
    );
    return decoded as R;
  });

export * from "./builtin/index.ts";
