import type { Prompt, Sandbox } from "@open-insight/core/internal";
import { Data, Schedule } from "effect";

/**
 * Read-only version of grading context.
 */
export type Context = Sandbox.ReadonlySandboxPromise & Readonly<{ response: Prompt.Parts }>;

export type Pred = (context: Context) => boolean | Promise<boolean>;
export type TrajPred = (part: Prompt.Part, context: Context) => boolean | PromiseLike<boolean>;

export const always = () => true;
export const never = () => false;

export type Policy = Schedule.Schedule<unknown>;

export type When = Data.TaggedEnum<{
  /**
   * Passively wait for a trajectory predicate to be satisfied.
   */
  Traj: Readonly<{ pred: TrajPred }>;

  /**
   * Proactively poll a sandbox & trajectory predicate until it is satisfied.
   */
  Schedule: Readonly<{
    schedule: Policy;
    pred?: Pred;
  }>;
}>;
const When = Data.taggedEnum<When>();

export const traj = (pred: TrajPred): When => When.Traj({ pred });

export const schedule = (schedule: Policy, pred: Pred = always): When =>
  When.Schedule({ schedule, pred });

export * from "effect/Schedule";
export * from "./builtin/index.ts";
