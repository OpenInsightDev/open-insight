import { Effect, Random } from "effect";
import { produce } from "immer";
import type * as Task from "../task/index.ts";
import type { Bench } from "./build.ts";

const withTasks = <T extends Task.Task>(bench: Bench<T>, tasks: ReadonlyArray<T>): Bench<T> => ({
  ...bench,
  metadata: produce(bench.metadata, (draft) => {
    draft.subset = true;
  }),
  tasks,
});

export const skip =
  (n: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.map(self, (bench) => withTasks(bench, bench.tasks.slice(n)));

export const head =
  (n: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.map(self, (bench) => withTasks(bench, bench.tasks.slice(0, n)));

export const select = (ids: ReadonlyArray<Task.ID>) => {
  const selectedIds = new Set(ids);

  return <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.map(self, (bench) =>
      withTasks(
        bench,
        bench.tasks.filter((task) => selectedIds.has(task.metadata.id)),
      ),
    );
};

export const randomSelect =
  (taskCount: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.flatMap(self, (bench) =>
      Effect.map(Random.shuffle(bench.tasks), (tasks) =>
        withTasks(bench, tasks.slice(0, taskCount)),
      ),
    );
