import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import type { TrailResult } from "#/metric/task/index.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Bench } from "./build.ts";
import { BenchError } from "./error.ts";

const mapBenchExec = <G extends Grade.AnyResult, M, R extends Schema.JsonObject>(
  mapper: (grade: G["Type"]) => M,
  exec: Metric.Bench.Exec<M, R>,
): Metric.Bench.Exec<G["Type"], R> => {
  const mapTrail = (trail: TrailResult<G["Type"]>): TrailResult<M> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  return (results, delta, prev) =>
    exec(
      Object.fromEntries(
        Object.entries(results).map(([task, trails]) => [task, trails.map(mapTrail)]),
      ),
      delta.map(mapTrail),
      prev,
    );
};

const mapTaskExec = <G extends Grade.AnyResult, M, R extends Schema.JsonObject>(
  mapper: (grade: G["Type"]) => M,
  exec: Metric.Task.Exec<M, R>,
): Metric.Task.Exec<G["Type"], R> => {
  const mapTrail = (trail: TrailResult<G["Type"]>): TrailResult<M> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  return (results, delta, prev) => exec(results.map(mapTrail), mapTrail(delta), prev);
};

export const metric =
  <G extends Grade.AnyResult, MR extends Schema.JsonObject>(
    exec: Metric.Bench.Exec<G["Type"], MR>,
    options: Omit<Metric.Bench.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) =>
      Metric.Bench.make({ ...options, exec }).pipe(
        Effect.mapError(BenchError.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

export const mapMetric =
  <G extends Grade.AnyResult, M, MR extends Schema.JsonObject>(
    mapper: (grade: G["Type"]) => M,
    exec: Metric.Bench.Exec<M, MR>,
    options: Omit<Metric.Bench.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) =>
      Metric.Bench.make({ ...options, exec: mapBenchExec(mapper, exec) }).pipe(
        Effect.mapError(BenchError.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

export const taskMetric =
  <G extends Grade.AnyResult, MR extends Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Task.Exec<G["Type"], MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(BenchError.taskNotFound(taskId));
      }

      return Metric.Task.make({ ...options, exec }).pipe(
        Effect.mapError(BenchError.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.metrics.push(castDraft(metric));
                break;
              }
            }
          }),
        ),
      );
    });

export const mapTaskMetric =
  <G extends Grade.AnyResult, M, MR extends Schema.JsonObject>(
    taskId: Task.ID,
    mapper: (grade: G["Type"]) => M,
    exec: Metric.Task.Exec<M, MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(BenchError.taskNotFound(taskId));
      }

      return Metric.Task.make({ ...options, exec: mapTaskExec(mapper, exec) }).pipe(
        Effect.mapError(BenchError.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.metrics.push(castDraft(metric));
                break;
              }
            }
          }),
        ),
      );
    });

export const trajMetric =
  <R extends Schema.JsonObject = Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench<T>, E, R>,
  ): Effect.Effect<Bench<T>, E | BenchError, R> =>
    bench.pipe(
      Effect.flatMap(
        Effect.fn(function* (bench) {
          if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
            return yield* Effect.fail(BenchError.taskNotFound(taskId));
          }

          const metric = yield* Metric.Traj.make({ ...options, exec }).pipe(
            Effect.mapError(BenchError.init),
          );

          return produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.trajMetrics.push(castDraft(metric));
                break;
              }
            }
          });
        }),
      ),
    );
