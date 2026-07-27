import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import * as Grade from "#/grade/index.ts";
import type { Bench } from "./build.ts";
import { Error } from "./error.ts";

export const metric =
  <G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
    options: Metric.Bench.Options<G, R>,
  ) =>
  <T extends Task.Task<G>, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.all([bench, Metric.Bench.make(options).pipe(Effect.mapError(Error.init))]).pipe(
      Effect.map(([bench, metric]) =>
        produce(bench, (draft) => {
          draft.metrics.push(castDraft(metric));
        }),
      ),
    );

export const taskMetric =
  <R extends Schema.JsonObject = Schema.JsonObject>(
    taskId: Task.ID,
    options: Metric.Task.Options<Grade.Result, R>,
  ) =>
  <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return Metric.Task.make(options).pipe(
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
  <R extends Schema.JsonObject = Schema.JsonObject>(
    taskId: Task.ID,
    options: Metric.Traj.Options<R>,
  ) =>
  <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return Metric.Traj.make(options).pipe(
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
