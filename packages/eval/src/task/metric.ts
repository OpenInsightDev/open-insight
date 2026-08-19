import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Task } from "./build.ts";
import { TaskError } from "./error.ts";

const mapExec = <G extends Grade.AnyResult, M, R extends Schema.Json>(
  mapper: (grade: G["Type"]) => M,
  exec: Metric.Task.Exec<M, R>,
): Metric.Task.Exec<G["Type"], R> => {
  const mapTrail = (trail: Metric.Task.TrailResult<G["Type"]>): Metric.Task.TrailResult<M> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  return (results, delta, prev) => exec(results.map(mapTrail), mapTrail(delta), prev);
};

export const mapMetric =
  <G extends Grade.AnyResult, M, MR extends Schema.Json>(
    mapper: (grade: G["Type"]) => M,
    exec: Metric.Task.Exec<M, MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(task: Effect.Effect<Task<G>, E, R>) =>
    Effect.flatMap(task, (task) =>
      Metric.Task.make({ ...options, exec: mapExec(mapper, exec) }).pipe(
        Effect.mapError(TaskError.metadata),
        Effect.map((metric) =>
          produce(task, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

export const metric =
  <G extends Grade.AnyResult, MR extends Schema.Json>(
    exec: Metric.Task.Exec<G["Type"], MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <E, R>(task: Effect.Effect<Task<G>, E, R>) =>
    Effect.flatMap(task, (task) =>
      Metric.Task.make({ ...options, exec }).pipe(
        Effect.mapError(TaskError.metadata),
        Effect.map((metric) =>
          produce(task, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

export const trajMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <G extends Grade.AnyResult, E, R>(
    task: Effect.Effect<Task<G>, E, R>,
  ): Effect.Effect<Task<G>, E | Error, R> =>
    Effect.flatMap(
      task,
      Effect.fn(function* (task) {
        const metric = yield* Metric.Traj.make({ ...options, exec }).pipe(
          Effect.mapError(TaskError.metadata),
        );

        return produce(task, (draft) => {
          draft.trajMetrics.push(metric);
        });
      }),
    );

export const schedMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    exec: Metric.Sched.Exec<R>,
    options: Omit<Metric.Sched.Options<R>, "exec"> = {},
  ) =>
  <G extends Grade.AnyResult, E, R>(
    task: Effect.Effect<Task<G>, E, R>,
  ): Effect.Effect<Task<G>, E | Error, R> =>
    Effect.flatMap(
      task,
      Effect.fn(function* (task) {
        const metric = yield* Metric.Sched.make({ ...options, exec }).pipe(
          Effect.mapError(TaskError.metadata),
        );

        return produce(task, (draft) => {
          draft.schedMetrics.push(metric as Metric.Sched.Metric);
        });
      }),
    );
