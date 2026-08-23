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

export class Bench<ID extends string, Tasks extends Record<string, Task.Any>> extends Data.Class<{
  id: ID;
  tasks: Tasks;
}> {}
export type IDOf<B> = B extends Bench<infer ID, any> ? ID : never;
export type TasksOf<B> = B extends Bench<any, infer Tasks> ? Tasks : never;

export type Any = Bench<any, any>;

type Options<ID extends string> = Readonly<{
  id: ID;
}>;
export const fromArray = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  { id }: Options<ID>,
  tasks: Tasks,
): Bench<ID, TasksByName<Tasks>> =>
  new Bench({ id, tasks: Object.fromEntries(tasks.map((task) => [task.id, task])) });

export const make = <ID extends string, Tasks extends ReadonlyArray<Task.Any>>(
  { id }: Options<ID>,
  ...tasks: Tasks
): Bench<ID, TasksByName<Tasks>> => fromArray({ id }, tasks);

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
  (bench: B): Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, Name, Mapped>>> =>
    bench.pipe(
      produce((draft) => {
        draft.tasks[name] = mapper(draft.tasks[name]);
      }),
    );
