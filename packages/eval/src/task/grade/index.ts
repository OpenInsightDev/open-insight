import type { Agent, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "@/utils/variant.ts";
import { Effect, Schema } from "effect";
import { TaskError } from "../error.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Agent.Trajectory;
  }>;

export type Result<G extends Schema.Struct.Fields = Schema.Struct.Fields> = Schema.Schema.Type<
  Schema.Struct<G>
>;
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Grader<G extends Schema.Struct.Fields = Schema.Struct.Fields> = Bivariant<
  (ctx: Context) => PromiseLike<Result<G>>
>;

/**
 * Run a collection of graders with the given context.
 */
export const run = <G extends Schema.Struct.Fields = Schema.Struct.Fields>(grader: Grader<G>) =>
  Effect.fn(function* (
    ctx: Context,
  ): Effect.fn.Return<Schema.Schema.Type<Schema.Struct<G>>, TaskError> {
    const result = yield* Effect.tryPromise(() => grader(ctx)).pipe(
      Effect.mapError(TaskError.gradeExec),
    );
    const decoded = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
      Effect.mapError(TaskError.gradeResult),
    );
    return decoded as Schema.Schema.Type<Schema.Struct<G>>;
  });

export * from "./builtin/index.ts";
