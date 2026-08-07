import type { Prompt, Sandbox, Snapshot } from "@open-insight/core/internal";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";
import type { Result, Results } from "./index.ts";
import type { Verif } from "./verif.ts";

export type SandboxScope = "per-task" | "per-trail";

type TransferOptions = Readonly<{
  /** Path in the agent sandbox to copy. Files and directories are supported. */
  agentPath: string;
  /** Destination in the grade sandbox. Defaults to `agentPath`. */
  gradePath?: string;
}>;

export type Context<Rs extends Results = never> = Sandbox.SandboxPromise &
  Readonly<{
    /** The sandbox in which the agent performed the task. */
    agent: Sandbox.SandboxPromise;

    /** Trasfer a file or directory from the agent sandbox to the grade sandbox. */
    transfer(options: TransferOptions): Promise<void>;

    prevResults: UnionToIntersection<Rs>;
    trajectory: Prompt.Trajectory;
  }>;

export type Exec<R extends Result = Result, Rs extends Results = never> = BivariantFn<
  (ctx: Context<Rs>) => PromiseLike<R["Encoded"]>
>;

type Config = Readonly<{
  scope: SandboxScope;
}>;

export type Grader<R extends Result = Result, Rs extends Results = never> = Readonly<{
  schema: R;
  grade: Exec<R, Rs>;
  snapshot: Snapshot.Snapshot;
  verif: Verif<R> | null;
  config: Config;
}>;

type Options<R extends Result> = Readonly<{
  scope?: SandboxScope;
  verif?: Verif<R> | null;
}> &
  Partial<Config>;

export const make =
  <R extends Result>(schema: R) =>
  <Rs extends Results>(
    grade: Exec<R, Rs>,
    snapshot: Snapshot.Snapshot,
    { verif = null, scope = "per-trail" }: Options<R> = {},
  ): Grader<R, Rs> => ({
    schema,
    grade,
    snapshot,
    verif,
    config: {
      scope,
    },
  });
