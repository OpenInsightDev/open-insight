import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import type { Prompt } from "@open-insight/core/internal";

type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

type Delta<G extends Grade.Result = Grade.Result> = Result<G> & Readonly<{ task: Task.ID }>;

type Results<G extends Grade.Result = Grade.Result> = Readonly<Record<Task.ID, Array<Result<G>>>>;

export type Exec<G extends Grade.Result = Grade.Result, R = unknown> = (
  results: Results<G>,
  delta: Delta<G>,
  prev: R | null,
) => Promise<R>;
