import * as Grade from "#/grade/index.ts";
import * as Chart from "#/chart/index.ts";
import * as Task from "#/task/index.ts";
import type { Prompt } from "@open-insight/core/internal";
import type { Schema } from "effect";

export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

export type Input<G extends Grade.Result = Grade.Result> = Readonly<
  Record<Task.ID, Array<Result<G>>>
>;
export type Delta<G extends Grade.Result = Grade.Result> = Readonly<{
  task: Task.ID;
  result: Result<G>;
}>;

type Exec<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = (input: Input<G>, delta: Delta<G>) => Promise<R>;

export type Metric<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  name: string;
  exec: Exec<G, R>;

  description: string | null;
  chart: Chart.Chart<R> | null;
}>;

type Options<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  name: string;
  exec: Exec<G, R>;

  description?: string | null;
  chart?: Chart.Chart<R> | null;
}>;

export const make = <
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
>({
  name,
  exec,
  description = null,
  chart = null,
}: Options<G, R>): Metric<G, R> => ({ name, exec, description, chart });
