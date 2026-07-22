import * as Grade from "#/grade/index.ts";
import type { Prompt } from "@open-insight/core/internal";

export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

type Results<G extends Grade.Result = Grade.Result> = ReadonlyArray<Result<G>>;

export type Exec<G extends Grade.Result = Grade.Result, R = unknown> = (
  results: Results<G>,
  delta: Result<G>,
  prev: R | null,
) => Promise<R>;
