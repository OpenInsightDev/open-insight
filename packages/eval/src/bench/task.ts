import * as Task from "#/task/index.ts";
import { Effect } from "effect";
import { Bench, type Any, type IDOf, type TasksOf } from "./bench.ts";
import type { Override } from "@open-insight/core/internal/utils";

export type MappedTasks<
  Tasks extends Record<string, Task.Any>,
  ID extends keyof Tasks,
  Mapped extends Task.Any,
> = {
  readonly [Key in keyof Tasks]: Key extends ID ? Mapped : Tasks[Key];
};

export const mapTasks =
  <B extends Any, Mapped extends Record<string, Task.Any>>(
    mapper: (tasks: TasksOf<B>, bench: B) => Mapped,
  ) =>
  (bench: B): Override<B, Bench<IDOf<B>, Mapped>> => {
    const tasks: TasksOf<B> = bench.tasks;

    // oxlint-disable-next-line typescript/consistent-type-assertions typescript/no-unsafe-type-assertion TypeScript cannot express that cloning B while replacing its tasks preserves all other properties of B.
    return Object.assign(new Bench(bench), {
      tasks: mapper(tasks, bench),
    }) as Override<B, Bench<IDOf<B>, Mapped>>;
  };

export const mapTasksEffect = <B extends Any, Mapped extends Record<string, Task.Any>, E, R>(
  mapper: (tasks: TasksOf<B>, bench: B) => Effect.Effect<Mapped, E, R>,
) =>
  Effect.fn("Bench.mapTasksEffect")(function* (
    bench: B,
  ): Effect.fn.Return<Override<B, Bench<IDOf<B>, Mapped>>, E, R> {
    const tasks: TasksOf<B> = bench.tasks;
    const mapped = yield* mapper(tasks, bench);
    return mapTasks<B, Mapped>(() => mapped)(bench);
  });

export const mapTask =
  <B extends Any, ID extends keyof TasksOf<B>, Mapped extends Task.Any>(
    id: ID,
    mapper: (task: TasksOf<B>[ID], bench: B) => Mapped,
  ) =>
  (bench: B): Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>> => {
    const tasks: TasksOf<B> = bench.tasks;

    // oxlint-disable-next-line typescript/consistent-type-assertions typescript/no-unsafe-type-assertion TypeScript cannot express that replacing a dynamic key changes only that task's type.
    return Object.assign(new Bench(bench), {
      tasks: { ...tasks, [id]: mapper(tasks[id], bench) },
    }) as Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>>;
  };

export const mapTaskEffect = <
  B extends Any,
  ID extends keyof TasksOf<B>,
  Mapped extends Task.Any,
  E,
  R,
>(
  id: ID,
  mapper: (task: TasksOf<B>[ID], bench: B) => Effect.Effect<Mapped, E, R>,
) =>
  Effect.fn("Bench.mapTaskEffect")(function* (
    bench: B,
  ): Effect.fn.Return<Override<B, Bench<IDOf<B>, MappedTasks<TasksOf<B>, ID, Mapped>>>, E, R> {
    const tasks: TasksOf<B> = bench.tasks;
    const mapped = yield* mapper(tasks[id], bench);
    return mapTask<B, ID, Mapped>(id, () => mapped)(bench);
  });
