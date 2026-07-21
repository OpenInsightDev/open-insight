import { Prompt, type Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import { Effect, Equal, Schema } from "effect";
import { Error } from "./error.ts";
import { isFunction } from "effect/Predicate";

export type SandboxContext = Sandbox.SandboxPromise;
export type Context = SandboxContext &
  Readonly<{
    trajectory: Prompt.Trajectory;
  }>;

// grade result must be json serializable
export const Result = Schema.Record(Schema.String, Schema.Json);
export type Result = Schema.Schema.Type<typeof Result>;

export type BaseGrader<R extends Result = Result> = Bivariant<(ctx: Context) => PromiseLike<R>>;

type Verifier = (sandbox: SandboxContext) => PromiseLike<Prompt.Trajectory | null>;
export type VerifGrader<R extends Result = Result> = Readonly<{
  verif: Verifier;
  grade: BaseGrader<R>;
  expect: R;
}>;

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
 * @throws A {@link Prompt.UserMessage} to send additional guidance to the agent and continue its
 * current trajectory, for example when the expected task has not yet been completed.
 *
 * @example Grading the current sandbox state and trajectory
 *
 * ```ts
 * const grader: Grader<{ score: number; summary: string }> = async ({ $, trajectory }) => {
 *   const output = await $`cat /workspace/result.txt`;
 *
 *   if (output.length === 0) {
 *     throw Prompt.userMessage({
 *       content: "result is empty. Please write the result to /workspace/result.txt.",
 *     });
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
 * const grader: Grader<{ passed: boolean }> = {
 *   verif: async ({ writeFile }) => {
 *     await writeFile({ sandboxPath: "/workspace/result.txt", content: "RESULT: ok" });
 *     return null; // no trajectory needed for this verifier
 *   },
 *   grade: async ({ readFile }) => {
 *     const output = await readFile({ sandboxPath: "/workspace/result.txt" });
 *     return { passed: output === "RESULT: ok" };
 *   },
 *   expect: { passed: true },
 * };
 * ```
 */
export type Grader<R extends Result = Result> = BaseGrader<R> | VerifGrader<R>;

export const run = <R extends Result>(grader: Grader<R>) =>
  Effect.fn(function* (ctx: Context): Effect.fn.Return<R, Error> {
    const exec = isFunction(grader) ? grader : grader.grade;
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

export const verify = ({ verif: verify, grade: exec, expect }: VerifGrader) =>
  Effect.fn(function* (sandbox: Sandbox.SandboxPromise): Effect.fn.Return<boolean, Error> {
    const trajectory = yield* Effect.tryPromise(() => verify(sandbox)).pipe(
      Effect.mapError(Error.verify),
    );
    const result = yield* run(exec)({ ...sandbox, trajectory: trajectory ?? Prompt.empty });
    return Equal.equals(result, expect);
  });

export * from "./builtin/index.ts";
export * from "./error.ts";
