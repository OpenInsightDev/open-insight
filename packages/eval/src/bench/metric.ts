import { Crypto, Effect } from "effect";
import { castDraft, produce } from "immer";
import * as BenchMetric from "#/metric/bench.ts";
import * as TaskMetric from "#/metric/task.ts";
import * as TrajMetric from "#/metric/traj.ts";
import type * as Task from "#/task/index.ts";
import type { Bench } from "./build.ts";
import { Error } from "./error.ts";

export const metric =
  (options: BenchMetric.Options) =>
  <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.all([bench, BenchMetric.make(options).pipe(Effect.mapError(Error.init))]).pipe(
      Effect.map(([bench, metric]) =>
        produce(bench, (draft) => {
          draft.metrics.push(castDraft(metric));
        }),
      ),
    );

export const taskMetric =
  (taskId: Task.ID, options: TaskMetric.Options) =>
  <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return TaskMetric.make(options).pipe(
        Effect.mapError(Error.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.metrics.push(castDraft(metric));
                return;
              }
            }
          }),
        ),
      );
    });

export const trajMetric =
  (taskId: Task.ID, options: TrajMetric.Options) =>
  <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return TrajMetric.make(options).pipe(
        Effect.mapError(Error.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.trajMetrics.push(castDraft(metric));
                return;
              }
            }
          }),
        ),
      );
    });
