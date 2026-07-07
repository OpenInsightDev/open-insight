import type { Agent, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "@/utils/variant.ts";
import { Effect, Schema } from "effect";
import { TaskError } from "../error.ts";
import type { EmptyRecord } from "@/utils/type.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Agent.Trajectory;
  }>;

export type Result<G extends Schema.Struct.Fields = EmptyRecord> = Schema.Schema.Type<
  Schema.Struct<G>
>;
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Grader<G extends Schema.Struct.Fields = EmptyRecord> = Bivariant<
  (ctx: Context) => PromiseLike<Result<G>>
>;

/**
 * Run a collection of graders with the given context.
 */
export const run = <G extends Schema.Struct.Fields = Schema.Struct.Fields>(grader: Grader<G>) =>
  Effect.fn(function* (ctx: Context): Effect.fn.Return<Result<G>, TaskError> {
    const result = yield* Effect.tryPromise(() => grader(ctx)).pipe(
      Effect.mapError(TaskError.gradeExec),
    );
    const decoded = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
      Effect.mapError(TaskError.gradeResult),
    );
    return decoded as Result<G>;
  });

export * from "./builtin/index.ts";
