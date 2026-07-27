import type { Prompt, Sandbox } from "@open-insight/core/internal";
import { Data, Schedule } from "effect";

/**
 * Read-only version of grading context.
 */
export type SandboxContext = Omit<Sandbox.SandboxPromise, "writeFile" | "expose" | "upload">;
export type Context = SandboxContext & Readonly<{ parts: Prompt.Parts }>;

export type Pred = (context: Context) => boolean | Promise<boolean>;
export type TrajPred = (part: Prompt.Part, parts: Prompt.Parts) => boolean;

export type Policy = Schedule.Schedule<unknown>;

export type When = Data.TaggedEnum<{
  /**
   * Passively wait for a trajectory predicate to be satisfied.
   */
  Traj: Readonly<{
    trajPred: TrajPred;
    pred?: Pred;
  }>;
  /**
   * Proactively poll a sandbox & trajectory predicate until it is satisfied.
   */
  Schedule: Readonly<{
    schedule: Policy;
    pred?: Pred;
  }>;
}>;
const When = Data.taggedEnum<When>();

type TrajOptions = Readonly<{
  pred?: Pred;
}>;
type ScheduleOptions = Readonly<{
  pred?: Pred;
}>;

export const traj = (pred: TrajPred, options: TrajOptions = {}): When =>
  When.Traj({ trajPred: pred, ...options });

export const schedule = (schedule: Policy, options: ScheduleOptions = {}): When =>
  When.Schedule({ schedule, ...options });

type ToolCallPart = Extract<Prompt.Part, { type: "tool-call" }>;
type ToolResultPart = Extract<Prompt.Part, { type: "tool-result" }>;
export type ToolCallContext = Readonly<{
  call: ToolCallPart;
  result: ToolResultPart;
}>;

export * from "effect/Schedule";
export * from "./builtin/index.ts";
