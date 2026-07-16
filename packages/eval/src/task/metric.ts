import * as Grade from "#/grade/index.ts";

export type Context = Grade.Context;

export type When = (ctx: Context) => Promise<boolean>;
export type Exec<R> = (ctx: Context) => Promise<R>;

export type Metric<N extends string, R> = Readonly<{
  name: N;
  when: When;
  exec: Exec<R>;
}>;
