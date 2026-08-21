import { Effect, Random } from "effect";
import { produce } from "immer";
import type * as Task from "#/task/index.ts";
import type { Bench } from "./build.ts";

const withTasks = <T extends Task.AnyTask>(bench: Bench<T>, tasks: ReadonlyArray<T>): Bench<T> => ({
  ...bench,
  metadata: produce(bench.metadata, (draft) => {
    draft.subset = true;
  }),
  tasks,
});

/** Removes the first `n` tasks from the benchmark, keeping the rest in source order. */
export const skip =
  (n: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(n);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

/** Keeps only the first `n` tasks of the benchmark, in source order. */
export const head =
  (n: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(0, n);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

/** Keeps only the last `n` tasks of the benchmark, in source order. */
export const tail =
  (n: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(-n);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

/** Keeps the tasks in the half-open range `[start, end)`, following `Array.slice` semantics including negative indexes. */
export const slice =
  (start: number, end?: number) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.slice(start, end);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

/** Keeps only the tasks whose `metadata.id` is contained in `ids`, in source order. */
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

/** Keeps only the tasks at the given indexes, in source order. */
export const selectAt = (indexes: ReadonlyArray<number>) => {
  const selectedIndexes = new Set(indexes);

  return <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.filter((_, index) => selectedIndexes.has(index));
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );
};

/**
 * Keeps only the tasks for which `predicate` returns `true`, in source order.
 * The predicate receives the full task value, so it can filter on the task's metadata, stages, or any other property.
 */
export const selectWhere =
  <T extends Task.AnyTask>(predicate: (task: T) => boolean) =>
  <E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) => {
        const tasks = bench.tasks.filter(predicate);
        return Effect.succeed(withTasks(bench, tasks));
      }),
    );

/** Shuffles the benchmark tasks and keeps `taskCount` randomly selected tasks. */
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

/** A percentage value expressed as a string, e.g. `"20%"`. */
export type Percentage = `${number}%`;

const parsePercentage = (percentage: Percentage): number => parseFloat(percentage) / 100;

/**
 * Shuffles the benchmark tasks and keeps `Math.floor(total * ratio)` tasks.
 * The `percentage` argument is a string such as `"20%"`.
 */
export const sample =
  (percentage: Percentage) =>
  <T extends Task.AnyTask, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    self.pipe(
      Effect.flatMap((bench) =>
        Random.shuffle(bench.tasks).pipe(
          Effect.map((tasks) =>
            withTasks(
              bench,
              tasks.slice(0, Math.floor(tasks.length * parsePercentage(percentage))),
            ),
          ),
        ),
      ),
    );
