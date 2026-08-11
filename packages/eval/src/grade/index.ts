import { type Grader as SandboxedGrader } from "./sandbox.ts";
import { type Grader as BaseGrader, type AnyResult } from "./base.ts";
import { Data } from "effect";

export type Grader<R extends AnyResult = AnyResult> = Data.TaggedEnum<{
  Base: BaseGrader<R>;
  Sandboxed: SandboxedGrader<R>;
}>;
export const Grader = Data.taggedEnum<Grader>();

export * from "./builtin/index.ts";
export * from "./error.ts";
export * from "./base.ts";
export * from "./retry.ts";
export * as Sandbox from "./sandbox.ts";
export * as Verif from "./verif.ts";
