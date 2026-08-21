import type { Schema } from "effect";

type MakeOptions<
  G extends Schema.Constraint,
  TaskResult extends Schema.Constraint = Schema.Void,
  BenchResult extends Schema.Constraint = Schema.Void,
> = Readonly<{
  grade: G;
  taskResult: TaskResult;
  benchResult: BenchResult;
}>;
