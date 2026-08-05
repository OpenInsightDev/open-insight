import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Stage, Task } from "./build.ts";
import { TaskError } from "./error.ts";

const mapExec = <G extends Grade.Result, M, R extends Schema.JsonObject>(
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
  <G extends Grade.Result, MR extends Schema.JsonObject>(
    exec: Metric.Task.Exec<G["Type"], MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <S extends Stage, E, R>(task: Effect.Effect<Task<G, S>, E, R>) =>
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

export const mapMetric =
  <G extends Grade.Result, M, MR extends Schema.JsonObject>(
    mapper: (grade: G["Type"]) => M,
    exec: Metric.Task.Exec<M, MR>,
    options: Omit<Metric.Task.Options<G["Type"], MR>, "exec"> = {},
  ) =>
  <S extends Stage, E, R>(task: Effect.Effect<Task<G, S>, E, R>) =>
    task.pipe(
      Effect.flatMap((task) =>
        Metric.Task.make({ ...options, exec: mapExec(mapper, exec) }).pipe(
          Effect.mapError(TaskError.metadata),
          Effect.map((metric) =>
            produce(task, (draft) => {
              draft.metrics.push(castDraft(metric));
            }),
          ),
        ),
      ),
    );

export const trajMetric =
  <R extends Schema.JsonObject = Schema.JsonObject>(
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <G extends Grade.Result, S extends Stage, E, R>(
    task: Effect.Effect<Task<G, S>, E, R>,
  ): Effect.Effect<Task<G, S>, E | Error, R> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* Metric.Traj.make({ ...options, exec }).pipe(
            Effect.mapError(TaskError.metadata),
          );

          return produce(task, (draft) => {
            draft.trajMetrics.push(castDraft(metric));
          });
        }),
      ),
    );
