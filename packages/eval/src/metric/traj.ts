import * as Grade from "#/grade/index.ts";
import { makeID } from "#/utils/id.ts";
import * as Chart from "#/chart/index.ts";
import { Data, Duration, Effect, Schedule, type Schema } from "effect";

export type Context = Omit<Grade.Context, "writeFile" | "expose" | "upload">;
type Retry = { retry?: Schedule.Schedule<unknown> };

/**
 * Controls when a trajectory metric runs during an agent prompt session.
 *
 * @remarks
 * `Exec` evaluates its predicate after each completed round of tool calls and runs the metric when the predicate returns `true`.
 * The predicate can access the current sandbox state and complete trajectory, but must remain fast because it blocks the agent loop.
 * It must also be read-only because observable sandbox changes can alter the agent's behavior.
 *
 * `Schedule` triggers the metric externally using a policy from Effect's `Schedule` module.
 *
 * @example Run after a file contains the expected value
 *
 * ```ts
 * const when = When.Exec({
 *   exec: ({ $ }) =>
 *     $`cat /workspace/status.txt`
 *       .then((output) => output.trim() === "ready")
 *       .catch(() => false),
 * });
 * // note that you can use `contentIs` instead
 * ```
 *
 * @example Run every 30 seconds
 *
 * ```ts
 * const when = When.Schedule(Schedule.fixed("30 seconds"));
 * ```
 */
export type When = Data.TaggedEnum<{
  Exec: { exec: (ctx: Context) => Promise<boolean> } & Retry;
  Schedule: Schedule.Schedule<unknown>;
}>;
export const When = Data.taggedEnum<When>();

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (ctx: Context) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  id: string;

  when: When;
  exec: Exec<R>;

  name: string;
  description: string | null;
  chart: Chart.Chart<R> | null;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;

  when?: When;
  name?: string;
  description?: string | null;
  chart?: Chart.Chart<R> | null;
}>;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>({
  exec,
  when = always,
  name = "Trajectory Metric",
  description = null,
  chart = null,
}: Options<R>) {
  return { id: yield* makeID(), name, exec, when, description, chart };
});

export const always = When.Exec({ exec: () => Promise.resolve(true) });

export const every = (input: Duration.Input) => When.Schedule(Schedule.fixed(input));

export const success = (bash: string, { retry }: Retry = {}) =>
  When.Exec({ exec: ({ $ }) => $`${bash}`.then(() => true).catch(() => false), retry });

export const fails = (bash: string, { retry }: Retry = {}) =>
  When.Exec({ exec: ({ $ }) => $`${bash}`.then(() => false).catch(() => true), retry });

export const bash = ({ bash, expect }: { bash: string; expect: string }, { retry }: Retry = {}) =>
  When.Exec({
    exec: ({ $ }) => $`${bash}`.then((stdout) => stdout.trim() === expect).catch(() => false),
    retry,
  });

export const content = (
  { sandboxPath, expect }: { sandboxPath: string; expect: string },
  { retry }: Retry = {},
) =>
  When.Exec({
    exec: ({ $ }) =>
      $`cat ${sandboxPath}`.then((stdout) => stdout.trim() === expect).catch(() => false),
    retry,
  });

export const exists = (sandboxPath: string, { retry }: Retry = {}) =>
  When.Exec({
    exec: ({ $ }) => $`test -f ${sandboxPath}`.then(() => true).catch(() => false),
    retry,
  });
