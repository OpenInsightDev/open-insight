import * as Task from "#/task/index.ts";
import { produce } from "immer";
import { Data } from "effect";

export type TasksByName<Tasks> =
  Tasks extends Record<string, Task.Any>
    ? { readonly [Name in keyof Tasks]: Tasks[Name] }
    : Tasks extends ReadonlyArray<Task.Any>
      ? { readonly [Task in Tasks[number] as Task["name"]]: Task }
      : never;

export class Bench<Tasks extends Record<string, Task.Any>> extends Data.Class<{
  name: string;
  tasks: Tasks;
}> {}

type Options = Readonly<{
  name: string;
}>;
export const make = <Tasks extends ReadonlyArray<Task.Any>>(
  { name }: Options,
  ...tasks: Tasks
): Bench<TasksByName<Tasks>> =>
  new Bench({
    name,
    tasks: Object.fromEntries(tasks.map((task) => [task.name, task])) as TasksByName<Tasks>,
  });

export type TasksOf<B> = B extends Bench<infer Tasks> ? Tasks : never;

type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  Name extends keyof Tasks,
  Mapped extends Tasks[Name],
> = {
  readonly [Key in keyof Tasks]: Key extends Name ? Mapped : Tasks[Key];
};

export const mapTask =
  <Tasks extends Record<string, Task.Any>, Name extends keyof Tasks, Mapped extends Tasks[Name]>(
    name: Name,
    mapper: (task: Tasks[Name]) => Mapped,
  ) =>
  (bench: Bench<Tasks>): Bench<MappedTasks<Tasks, Name, Mapped>> =>
    bench.pipe(
      produce((draft) => {
        draft.tasks[name] = mapper(draft.tasks[name]);
      }),
    );
