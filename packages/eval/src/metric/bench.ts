import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import type { Prompt } from "@open-insight/core";

type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

type Delta<G extends Grade.Result = Grade.Result> = Readonly<{
  task: Task.ID;
}> &
  Result<G>;

type Results<G extends Grade.Result = Grade.Result> = Readonly<Record<Task.ID, Array<Result<G>>>>;

export type Exec<G extends Grade.Result = Grade.Result, R = unknown> = (
  prev: R | null,
  delta: Delta<G>,
  results: Results<G>,
) => Promise<R>;
