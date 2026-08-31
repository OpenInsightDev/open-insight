import * as Task from "#/task/index.ts";
import { castDraft, produce } from "immer";
import { Effect } from "effect";
import type { Override } from "../utils/type.ts";
import type { Any, Bench, IDOf, TasksOf } from "./bench.ts";

export type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  Name extends keyof Tasks,
  Mapped extends Task.Any,
> = {
  readonly [Key in keyof Tasks]: Key extends Name ? Mapped : Tasks[Key];
};

type TaskName<B extends Any> = Extract<keyof TasksOf<B>, string>;
type TaskWithId<Name extends string> = Task.Any & Readonly<{ id: Name }>;

export type TaskMappers<B extends Any> = {
  readonly [Name in TaskName<B>]: (task: TasksOf<B>[Name], bench: B) => TaskWithId<Name>;
};

export type MappedTaskRecord<B extends Any, Mappers extends TaskMappers<B>> = {
  readonly [Name in keyof TasksOf<B>]: Name extends keyof Mappers
    ? ReturnType<Mappers[Name]>
    : never;
};

export const mapTasks =
  <B extends Any, const Mappers extends TaskMappers<B>>(mappers: Mappers) =>
  (bench: B): Override<B, Bench<IDOf<B>, MappedTaskRecord<B, Mappers>>> =>
    // Object iteration cannot preserve the relationship between each task key and mapper return type.
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
    produce(bench, (draft) => {
      const map = <Name extends TaskName<B>>(name: Name) => {
        draft.tasks[name] = castDraft(mappers[name](bench.tasks[name], bench));
      };

      for (const name in bench.tasks) {
        map(name);
      }
    }) as unknown as Override<B, Bench<IDOf<B>, MappedTaskRecord<B, Mappers>>>;

export const mapTask =
  <B extends Any, Name extends Extract<keyof TasksOf<B>, string>, Mapped extends Task.Any>(
    name: Name,
    mapper: (task: TasksOf<B>[Name], bench: B) => Mapped,
  ) =>
  (bench: B): Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, Name, Mapped>>> =>
    // The mapped task changes the task-record type, which Immer cannot preserve
    // through its Draft transformation for a generic record.
    // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
    produce(bench, (draft) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
      draft.tasks[name] = castDraft(mapper(bench.tasks[name] as TasksOf<B>[Name], bench));
    }) as unknown as Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, Name, Mapped>>>;

export const mapTaskEffect =
  <B extends Any, Name extends Extract<keyof TasksOf<B>, string>, Mapped extends Task.Any, E, R>(
    name: Name,
    mapper: (task: TasksOf<B>[Name], bench: B) => Effect.Effect<Mapped, E, R>,
  ) =>
  (
    bench: B,
  ): Effect.Effect<Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, Name, Mapped>>>, E, R> =>
    Effect.map(
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
      mapper(bench.tasks[name] as TasksOf<B>[Name], bench),
      (mapped) => mapTask<B, Name, Mapped>(name, () => mapped)(bench),
    );
