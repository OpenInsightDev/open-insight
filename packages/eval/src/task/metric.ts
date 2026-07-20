import * as Grade from "#/grade/index.ts";
import type { Data, Schedule, Schema } from "effect";

export type Context = Grade.Context;

export type When = Data.TaggedEnum<{
  Check: (ctx: Context) => Promise<boolean>;
  Schedule: Schedule.Schedule<number>;
}>;

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (ctx: Context) => Promise<R>;

export type Metric<
  N extends string = string,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  name: N;
  when: When;
  exec: Exec<R>;
}>;
