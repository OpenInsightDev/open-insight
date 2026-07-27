import { Agent, Prompt, type Sandbox } from "@open-insight/core/internal";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
import { Error, Retry } from "./error.ts";
import { Response } from "effect/unstable/ai";

// grade result must be json serializable
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Result = Schema.Schema.Type<typeof Result>;

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

export type InputGrader<R extends Result = Result, Rs extends Results = never> =
  | ((ctx: Context<Rs>) => PromiseLike<R>)
  | Readonly<{
      verif: Verifier;
      grade: (ctx: Context<Rs>) => PromiseLike<R>;
      expect: NoInfer<R>;
    }>;

export type ExecutableGrader<R extends Result = Result, Rs extends Results = never> = BaseGrader<
  R,
  Rs
>;

export type Verifier = (
  options: Sandbox.SandboxPromise &
    Readonly<{
      trajectory: Prompt.Trajectory;
    }>,
) => PromiseLike<Prompt.RawInput | null>;
export type VerifGrader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  verif: Verifier;
  grade: BaseGrader<R, Rs>;
  expect: R;
}>;

export type Options<R extends Result = Result> = Readonly<{
  verif: Verifier;
  expect: NoInfer<R>;
}>;

export const make = <R extends Result, Rs extends Results = never>(
  exec: Exec<R, Rs>,
  options: Options<R>,
): VerifGrader<R, Rs> => ({ ...options, grade: exec });

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
 * const grader: Grade.Grader<{ score: number; summary: string }> = async ({ $, trajectory }) => {
 *   const output = await $`cat /workspace/result.txt`;
 *
 *   if (output.length === 0) {
 *     throw Grade.retry("result is empty. Please write the result to /workspace/result.txt.");
 *   }
 *   if (!output.startsWith("RESULT:")) {
 *     throw new Error("result.txt has an invalid format");
 *   }
 *
 *   return {
 *     score: 1,
 *     summary: `Accepted after ${trajectory.length} trajectory entries`,
 *   };
 * };
 * ```
 *
 * @example Grading with a verifier and an expected result
 *
 * ```ts
 * const grader = Grade.make(
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
export type Grader<R extends Result = Result, Rs extends Results = never> =
  | ExecutableGrader<R, Rs>
  | VerifGrader<R, Rs>;

export const isVerifiable = (grader: Grader): grader is VerifGrader => "verif" in grader;
export const assertVerifiable: (grader: Grader) => asserts grader is VerifGrader = (
  grader: Grader,
) => {
  if (!isVerifiable(grader)) {
    throw new globalThis.Error("Grader is not verifiable");
  }
};

export const run = (grader: Grader<Result, Results>) =>
  Effect.fn(function* (ctx: Context<Results>): Effect.fn.Return<Result, Error | Retry> {
    const executable = isVerifiable(grader) ? grader.grade : grader;
    const result = yield* Effect.tryPromise({
      try: () => executable(ctx),
      catch: (cause) => (cause instanceof Retry ? cause : Error.exec(cause)),
    });
    return yield* Schema.decodeEffect(Result)(result).pipe(Effect.mapError(Error.result));
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
export * as Sandbox from "./sandbox/index.ts";
