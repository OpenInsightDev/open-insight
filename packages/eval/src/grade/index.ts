import { type Grader as SandboxedGrader } from "./sandbox.ts";
import { type Grader as BaseGrader, type Result, type Results } from "./base.ts";
import { Data } from "effect";

export type Grader<R extends Result = Result, Rs extends Results = never> = Data.TaggedEnum<{
  Base: BaseGrader<R, Rs>;
  Sandboxed: SandboxedGrader<R, Rs>;
}>;
export const Grader = Data.taggedEnum<Grader>();

export * from "./builtin/index.ts";
export * from "./error.ts";
export * as Sandbox from "./sandbox.ts";
