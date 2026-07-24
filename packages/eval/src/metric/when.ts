import type { Prompt, Sandbox } from "@open-insight/core/internal";
import { Data, Duration, Schedule as EffectSchedule } from "effect";

/**
 * Read-only version of grading context.
 */
export type Context = Omit<Sandbox.SandboxPromise, "writeFile" | "expose" | "upload"> &
  Readonly<{ trajectory: Prompt.Trajectory }>;

export type Exec = (context: Context) => boolean | Promise<boolean>;
export type On = (trajectory: Prompt.Trajectory) => boolean;
export type Policy = EffectSchedule.Schedule<unknown>;

type ExecOptions = Readonly<{ exec?: Exec }>;
type ScheduleOptions = ExecOptions & Readonly<{ retry?: Policy }>;

/** A predicate which never prevents a trajectory metric from running. */
export const always = () => true;

/**
 * Controls when a trajectory metric runs during an agent session.
 *
 * `Traj` evaluates a synchronous, trajectory-only predicate after a completed tool round. Once it
 * matches, its `exec` predicate decides whether the metric should run.
 *
 * `Schedule` follows its timing policy for regular checks. A false `exec` result is silently
 * skipped when no retry policy is configured. With a retry policy, regular checks pause while
 * retry checks continue until one succeeds or the policy ends; a success runs the metric and
 * restarts the regular schedule from the beginning.
 */
export type When = Data.TaggedEnum<{
  Traj: Readonly<{
    on: On;
    exec: Exec;
  }>;
  Schedule: Readonly<{
    schedule: Policy;
    retry?: Policy;
    exec: Exec;
  }>;
}>;

const tagged = Data.taggedEnum<When>();

export const traj = (on: On = always, { exec = always }: ExecOptions = {}): When =>
  tagged.Traj({ on, exec });

export const schedule = (schedule: Policy, { retry, exec = always }: ScheduleOptions = {}): When =>
  tagged.Schedule({ schedule, retry, exec });

export const message = (role: Prompt.Message["role"], options: ExecOptions = {}) =>
  traj((trajectory) => trajectory.content.at(-1)?.role === role, options);

export const toolCall = (toolName?: string, options: ExecOptions = {}) =>
  traj((trajectory) => {
    const latest = trajectory.content.findLast(
      (message): message is Prompt.ToolMessage => message.role === "tool",
    );
    return (
      latest?.content.some(
        (part) => part.type === "tool-result" && (toolName === undefined || part.name === toolName),
      ) ?? false
    );
  }, options);

export const interval = (input: Duration.Input, options: ScheduleOptions = {}) =>
  schedule(EffectSchedule.fixed(input), options);

export const success =
  (bash: string): Exec =>
  ({ $ }) =>
    $`${bash}`.then(() => true).catch(() => false);

export const fails =
  (bash: string): Exec =>
  ({ $ }) =>
    $`${bash}`.then(() => false).catch(() => true);

export const bash =
  ({ bash, expect }: { bash: string; expect: string }): Exec =>
  ({ $ }) =>
    $`${bash}`.then((stdout) => stdout.trim() === expect).catch(() => false);

export const content =
  ({ sandboxPath, expect }: { sandboxPath: string; expect: string }): Exec =>
  ({ $ }) =>
    $`cat ${sandboxPath}`.then((stdout) => stdout.trim() === expect).catch(() => false);

export const exists =
  (sandboxPath: string): Exec =>
  ({ $ }) =>
    $`test -f ${sandboxPath}`.then(() => true).catch(() => false);
