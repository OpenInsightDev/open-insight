import * as Task from "#/task/index.ts";
import type { Schema } from "effect";

type TaskResultsOf<Tasks extends Record<string, Task.Any>> = Task.Result.ResultsOf<Tasks>;

export type Exec<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = (
  results: TaskResultsOf<Tasks>,
) => S["Type"];
export type Fn<Tasks extends Record<string, Task.Any>, S extends Schema.Constraint> = Exec<
  Tasks,
  S
> &
  Readonly<{ schema: S }>;
