import * as Task from "#/task/index.ts";
import { produce } from "immer";
import { Data } from "effect";
import type { Override } from "../utils/type.ts";

export type TasksByName<Tasks> =
  Tasks extends Record<string, Task.Any>
    ? { readonly [Name in keyof Tasks]: Tasks[Name] }
    : Tasks extends ReadonlyArray<Task.Any>
      ? { readonly [Task in Tasks[number] as Task["id"]]: Task }
      : never;

export class Bench<Tasks extends Record<string, Task.Any>> extends Data.Class<{
  name: string;
  tasks: Tasks;
}> {}
export type Any = Bench<any>;

type Options = Readonly<{
  name: string;
}>;
export const make = <Tasks extends ReadonlyArray<Task.Any>>(
  { name }: Options,
  ...tasks: Tasks
): Bench<TasksByName<Tasks>> =>
  new Bench({
    name,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])) as TasksByName<Tasks>,
  });

export type TasksOf<B> = B extends Bench<infer Tasks> ? Tasks : never;

type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  Name extends keyof Tasks,
  Mapped extends Task.Any,
> = {
  readonly [Key in keyof Tasks]: Key extends Name ? Mapped : Tasks[Key];
};

export const mapTask =
  <B extends Any, Name extends keyof TasksOf<B>, Mapped extends Task.Any>(
    name: Name,
    mapper: (task: TasksOf<B>[Name]) => Mapped,
  ) =>
  (bench: B): Override<B, Bench<MappedTasks<TasksOf<B>, Name, Mapped>>> =>
    bench.pipe(
      produce((draft) => {
        draft.tasks[name] = mapper(draft.tasks[name]);
      }),
    );
