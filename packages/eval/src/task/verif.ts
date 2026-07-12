import type { Prompt, Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "#/utils/variant.ts";
import type * as Grade from "#/grade/index.ts";

type Return = Prompt.Trajectory | null;

export type Verifier<G extends Grade.Result = Grade.Result> = Readonly<{
  exec: Bivariant<(sandbox: Sandbox.SandboxPromise) => PromiseLike<Return> | Return>;
  expect: G;
}>;
