import type { Prompt, Sandbox } from "@open-insight/core/internal";
import type { Result, Results } from "../index.ts";
import type { BivariantFn, UnionToIntersection } from "#/utils/variant.ts";

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

export type Options = Readonly<{
  scope: SandboxScope;
}>;
