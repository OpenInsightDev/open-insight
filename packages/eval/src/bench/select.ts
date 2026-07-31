import { Effect, Random } from "effect";
import { produce } from "immer";
import type * as Task from "../task/index.ts";
import type { Bench } from "./build.ts";

const withTasks = <T extends Task.AnyTask>(bench: Bench<T>, tasks: ReadonlyArray<T>): Bench<T> => ({
  ...bench,
  metadata: produce(bench.metadata, (draft) => {
    draft.subset = true;
  }),
  tasks,
});

export const skip =
  (n: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(n);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

export const head =
  (n: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(0, n);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

export const select = (ids: ReadonlyArray<Task.ID>) => {
  const selectedIds = new Set(ids);

  return <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.filter((task) => selectedIds.has(task.metadata.id));
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );
};

export const randomSelect =
  (taskCount: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) =>
        Random.shuffle(bench.tasks).pipe(
          Effect.map((tasks) => withTasks(bench, tasks.slice(0, taskCount))),
        ),
      ),
    );
