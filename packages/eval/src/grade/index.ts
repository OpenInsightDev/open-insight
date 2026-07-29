import { Agent, Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
import { Error, Retry } from "./error.ts";
import { Response } from "effect/unstable/ai";

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
export type VerifOptions<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  verif: Verifier;
  expect: R;
}>;
export type Options<R extends Schema.JsonObject = Schema.JsonObject> = VerifOptions<R>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: ResultSchema<R>;
  grade: BaseGrader<Schema.JsonObject, Rs>;
}> &
  Partial<VerifOptions>;

export function make<GS extends ResultSchema, Rs extends Results = never>(
  schema: GS,
  grade: BaseGrader<GS["Encoded"], Rs>,
  options?: VerifOptions<GS["Encoded"]>,
): Grader<GS["Type"], Rs>;
export function make(
  schema: ResultSchema,
  grade: BaseGrader<Schema.JsonObject>,
  options?: VerifOptions,
): Grader {
  return options === undefined ? { schema, grade } : { schema, grade, ...options };
}

export const makeVerifAgent = ({
  verifier,
  sandbox,
}: {
  verifier: Verifier;
  sandbox: Sandbox.SandboxPromise;
}): Agent.Agent => {
  return {
    trajectory: Effect.fn(function* () {
      const input = yield* Effect.tryPromise(() =>
        verifier({ ...sandbox, trajectory: Prompt.empty }),
      ).pipe(Effect.mapError(Agent.Error.trajectory));
      return input === null ? Prompt.empty : Prompt.make(input);
    }),
    prompt: () =>
      Stream.fromIterable<Agent.StreamPart>([
        Response.makePart("finish", {
          reason: "stop",
          usage: Schema.decodeSync(Response.Usage)({
            inputTokens: {
              uncached: 0,
              total: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 0,
              text: 0,
              reasoning: 0,
            },
          }),
          response: undefined,
        }),
      ]),
  };
};

/**
 * Grades an agent run against task-specific criteria using the sandbox's current state and the
 * agent's execution trajectory.
 *
 * @remarks
 * A grade result is not limited to a numeric score.
 * It may be a JSON object with arbitrary fields, but the complete result must be serializable to a JSON string.
 *
 * A grader may include a verifier that produces a trajectory from the sandbox and an `expect`
 * value.
 * The grader runs against that sandbox state and trajectory, then its result is deep compared
 * with `expect` for equality.
 * This allows the grading logic to be validated without actually running an agent.
 *
 * @throws A {@link globalThis.Error} to abort this grader and all subsequent processing
 * immediately when the current state does not meet the grader's expectations.
 *
 * @throws A {@link Retry} created with {@link retry} to send another prompt to the agent before
 * grading again, for example when the expected task has not yet been completed.
 *
 * @example Grading the current sandbox state and trajectory
 *
 * ```ts
 * import { Grade } from "@open-insight/eval";
 *
 * class GradeResult extends Schema.Class<GradeResult>("GradeResult")({
 *   score: Schema.Number,
 *   summary: Schema.String,
 * }) {}
 *
 * const grader = Grade.make(GradeResult, async ({ $, trajectory }) => {
 *   const output = await $`cat /workspace/result.txt`;
 *   return { score: output.startsWith("RESULT:") ? 1 : 0, summary: `${trajectory.length}` };
 * });
 * ```
 *
 * @example Grading with a verifier and an expected result
 *
 * ```ts
 * const grader = Grade.make(
 *   GradeResult,
 *   async ({ readFile }) => {
 *     const output = await readFile({ sandboxPath: "/workspace/result.txt" });
 *     return { passed: output === "RESULT: ok" };
 *   },
 *   {
 *     verif: async ({ writeFile }) => {
 *       await writeFile({ sandboxPath: "/workspace/result.txt", content: "RESULT: ok" });
 *       return null; // no trajectory needed for this verifier
 *     },
 *     expect: { passed: true },
 *   },
 * );
 * ```
 */
export const isVerifiable = (grader: Grader): grader is Grader & VerifOptions => "verif" in grader;
export const assertVerifiable: (grader: Grader) => asserts grader is Grader & VerifOptions = (
  grader: Grader,
) => {
  if (!isVerifiable(grader)) {
    throw new globalThis.Error("Grader is not verifiable");
  }
};

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
