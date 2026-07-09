import type { Agent, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import type * as Grade from "#/grade/index.ts";

export type Verifier<G extends Grade.Result = Grade.Result> = Readonly<{
  exec: Bivariant<(sandbox: Sandbox.SandboxPromise) => PromiseLike<Agent.Trajectory | null>>;
  expect: G;
}>;
