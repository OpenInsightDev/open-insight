import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { Error, Retry } from "./error.ts";

// Concrete grade schemas may decode to domain objects such as Schema.Class instances, while
// every grade must still encode to a JSON object at persistence boundaries.
export const Result: Schema.Codec<object, Schema.JsonObject> = Schema.Record(
  Schema.String,
  Schema.Json,
);
export type Result = Schema.Schema.Type<typeof Result>;
export type ResultSchema<R extends Result = Result> = Schema.Codec<R, Schema.JsonObject>;

export type Results = Readonly<Record<PropertyKey, Result>>;

export type Context<Rs extends Results = never> = Sandbox.SandboxPromise &
  Readonly<{
    results: Rs;
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends Result = Result, Rs extends Results = never> = (
  ctx: Context<Rs>,
) => PromiseLike<R>;

export type BaseGrader<R extends Result = Result, Rs extends Results = never> = BivariantFn<
  Exec<R, Rs>
>;

export type Verifier = (
  options: Sandbox.SandboxPromise &
    Readonly<{
      trajectory: Prompt.Trajectory;
    }>,
) => PromiseLike<Prompt.RawInput | null>;

export type Definition<
  R extends Schema.JsonObject = Schema.JsonObject,
  Rs extends Results = never,
> = Readonly<{
  grade: BaseGrader<R, Rs>;
  verif?: Readonly<{
    run: Verifier;
    expect: R;
  }>;
}>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: ResultSchema<R>;
}> &
  Definition<Schema.JsonObject, Rs>;

/** Defines grading behavior. The enclosing task stage supplies the result schema. */
export const make = <R extends Schema.JsonObject, Rs extends Results = never>(
  grade: BaseGrader<NoInfer<R>, Rs>,
  options?: Readonly<{
    verif: Verifier;
    expect: NoInfer<R>;
  }>,
): Definition<R, Rs> =>
  options === undefined
    ? { grade }
    : { grade, verif: { run: options.verif, expect: options.expect } };

export const isVerifiable = <R extends Result, Rs extends Results>(
  grader: Grader<R, Rs>,
): grader is Grader<R, Rs> & Readonly<{ verif: NonNullable<Grader<R, Rs>["verif"]> }> =>
  grader.verif !== undefined;

export const run = <R extends Result, Rs extends Results>(grader: Grader<R, Rs>) =>
  Effect.fn(function* (ctx: Context<Rs>): Effect.fn.Return<R, Error | Retry> {
    const result = yield* Effect.tryPromise({
      try: () => grader.grade(ctx),
      catch: (cause) => (cause instanceof Retry ? cause : Error.exec(cause)),
    });
    return yield* Schema.decodeUnknownEffect(grader.schema)(result).pipe(
      Effect.mapError(Error.result),
    );
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
export * as Sandbox from "./sandbox/index.ts";
