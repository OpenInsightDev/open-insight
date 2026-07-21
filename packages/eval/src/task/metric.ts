import * as Grade from "#/grade/index.ts";
import * as Chart from "#/chart/index.ts";
import { Data, Duration, Schedule, type Schema } from "effect";

export type Context = Grade.Context;

export type When = Data.TaggedEnum<{
  Exec: { exec: (ctx: Context) => Promise<boolean> };
  Schedule: Schedule.Schedule<number>;
}>;
export const When = Data.taggedEnum<When>();

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (ctx: Context) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  name: string;
  when: When;
  exec: Exec<R>;

  description: string | null;
  chart: Chart.Chart<R> | null;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  name: string;
  exec: Exec<R>;

  when?: When;
  description?: string | null;
  chart?: Chart.Chart<R> | null;
}>;

export const make = <R extends Schema.JsonObject = Schema.JsonObject>({
  name,
  exec,
  when = always,
  description = null,
  chart = null,
}: Options<R>): Metric<R> => ({ name, exec, when, description, chart });

export const always = When.Exec({ exec: () => Promise.resolve(true) });

export const every = (input: Duration.Input) => When.Schedule(Schedule.fixed(input));

export const success = (bash: string) =>
  When.Exec({ exec: ({ $ }) => $`${bash}`.then(() => true).catch(() => false) });

export const fails = (bash: string) =>
  When.Exec({ exec: ({ $ }) => $`${bash}`.then(() => false).catch(() => true) });

export const assert = (bash: string, equals: string) =>
  When.Exec({
    exec: ({ $ }) => $`${bash}`.then((stdout) => stdout.trim() === equals).catch(() => false),
  });

export const exists = (sandboxPath: string) =>
  When.Exec({
    exec: ({ $ }) => $`test -f ${sandboxPath}`.then(() => true).catch(() => false),
  });
