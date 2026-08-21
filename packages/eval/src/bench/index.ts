import * as Task from "#/task/index.ts";

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
