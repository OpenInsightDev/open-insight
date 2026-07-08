import type { Sandbox } from "@open-insight/core/internal";
import type { Bivariant } from "@/utils/variant.ts";
import type * as Grade from "../grade/index.ts";

export type Verifier<R extends Grade.Result = Grade.Result> = Readonly<{
  exec: Bivariant<(sandbox: Sandbox.SandboxPromise) => PromiseLike<R>>;
  expected: R;
}>;

export const check =
  <R extends Grade.Result>(verifier: Verifier<R>) =>
  (sandbox: Sandbox.SandboxPromise) => {
    return true;
  };
