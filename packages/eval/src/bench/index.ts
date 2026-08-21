import * as Task from "#/task/index.ts";
import * as Grade from "#/grade/index.ts";
import { Schema } from "effect";

export type TasksByName<Tasks> =
  Tasks extends Record<string, Task.Any>
    ? { readonly [Name in keyof Tasks]: Tasks[Name] }
    : Tasks extends ReadonlyArray<Task.Any>
      ? { readonly [Task in Tasks[number] as Task["name"]]: Task }
      : never;

export interface Bench<in out Tasks extends Record<string, Task.Any>> {
  readonly tasks: Tasks;
}
export type TasksOf<B> = B extends Bench<infer Tasks> ? Tasks : never;

export const make = <Tasks extends ReadonlyArray<Task.Any>>(
  ...tasks: Tasks
): Bench<TasksByName<Tasks>> => {
  throw new Error("Not implemented");
};

const taskA = Task.make("taskA", {
  grader: Grade.embed(Schema.Struct({ passed: Schema.Boolean }))(async () => ({ passed: true })),
  prompt: { init: [] },
}).pipe(Task.Result.result(Schema.Struct({ passAt1: Schema.Number }))(() => ({ passAt1: 1 })));

const bench = make(taskA);
