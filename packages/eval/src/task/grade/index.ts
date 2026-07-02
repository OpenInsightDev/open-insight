import type { Agent, Sandbox } from "@open-insight/core/internal";
import type { Bivariant, UnionToIntersection } from "../../utils/variant.ts";
import { Brand, Effect, Schema } from "effect";
import { TaskError } from "../error.ts";

export type Context = Sandbox.SandboxPromise &
  Readonly<{
    trajectory: Agent.Trajectory;
  }>;

export type Exec<R = unknown> = Bivariant<(ctx: Context) => PromiseLike<R>>;

export type Grader<N extends string = string, R = unknown> = Readonly<{ name: N; exec: Exec<R> }> &
  Brand.Brand<N>;

export type Map<G> = UnionToIntersection<
  G extends Grader<infer N, infer R> ? Record<N, Exec<R>> : never
>;

export const ResultSchema = Schema.Record(Schema.String, Schema.Json);
export type Result<G> = UnionToIntersection<
  G extends Grader<infer N, infer R> ? Record<N, R> : never
>;

/**
 * Run a collection of graders with the given context.
 */
export const run = (map: Map<Grader>) =>
  Effect.fn(function* (ctx: Context) {
    const result: Record<string, unknown> = {};
    for (const [name, exec] of Object.entries(map)) {
      result[name] = yield* Effect.tryPromise({
        try: () => exec(ctx),
        catch: TaskError.gradeExec(name),
      });
    }
    return yield* Schema.decodeUnknownEffect(ResultSchema)(result).pipe(
      Effect.mapError(TaskError.gradeResult),
    );
  });

export * from "./builtin/index.ts";
