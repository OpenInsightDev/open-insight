import { Effect, Random } from "effect";
import { castDraft, produce } from "immer";
import type * as Task from "../task/index.ts";
import type { Bench } from "./build.ts";

export const skip =
  (n: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.map(self, (bench) =>
      produce(bench, (draft) => {
        draft.subset = true;
        draft.tasks = castDraft(bench.tasks.slice(n));
      }),
    );

export const head =
  (n: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.map(self, (bench) =>
      produce(bench, (draft) => {
        draft.subset = true;
        draft.tasks = castDraft(bench.tasks.slice(0, n));
      }),
    );

export const select = (ids: ReadonlyArray<Task.ID>) => {
  const selectedIds = new Set(ids);

  return <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.flatMap(self, (bench) =>
      Effect.map(Effect.all(bench.tasks, { concurrency: "unbounded" }), (tasks) =>
        produce(bench, (draft) => {
          draft.subset = true;
          draft.tasks = castDraft(
            tasks.filter((task) => selectedIds.has(task.metadata.name)).map(Effect.succeed),
          );
        }),
      ),
    );
};

export const randomSelect =
  (taskCount: number) =>
  <T extends Task.Task, E, R>(self: Effect.Effect<Bench<T>, E, R>) =>
    Effect.flatMap(self, (bench) =>
      Effect.map(Random.shuffle(bench.tasks), (tasks) =>
        produce(bench, (draft) => {
          draft.subset = true;
          draft.tasks = castDraft(tasks.slice(0, taskCount));
        }),
      ),
    );
