import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import type { TrailResult } from "#/metric/task/index.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Bench } from "./build.ts";
import { BenchError } from "./error.ts";
import { Sandbox } from "@open-insight/core/internal";

export const metric =
  <G extends Grade.AnyResult, MR extends Schema.Json>(
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

export const taskMetric =
  <G extends Grade.AnyResult, MR extends Schema.Json>(
    taskId: Task.ID,
    exec: Metric.Task.Collect.Exec<G["Type"], MR>,
    options: Omit<Metric.Task.Options, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(BenchError.taskNotFound(taskId));
      }

      return Metric.Task.makeCollect({ ...options, exec }).pipe(
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

const mapTaskExec = <G extends Grade.AnyResult, M, R extends Schema.Json>(
  mapper: (grade: G["Type"]) => M,
  exec: Metric.Task.Collect.Exec<M, R>,
): Metric.Task.Collect.Exec<G["Type"], R> => {
  const mapTrail = (trail: TrailResult<G["Type"]>): TrailResult<M> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  return (results) => exec(results.map(mapTrail));
};

export const mapTaskMetric =
  <G extends Grade.AnyResult, M, MR extends Schema.Json>(
    taskId: Task.ID,
    mapper: (grade: G["Type"]) => M,
    exec: Metric.Task.Collect.Exec<M, MR>,
    options: Omit<Metric.Task.Options, "exec"> = {},
  ) =>
  <E, R>(bench: Effect.Effect<Bench<Task.Task<G>>, E, R>) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(BenchError.taskNotFound(taskId));
      }

      return Metric.Task.makeCollect({ ...options, exec: mapTaskExec(mapper, exec) }).pipe(
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

const mapBenchExec = <G extends Grade.AnyResult, M, R extends Schema.Json>(
  mapper: (grade: G["Type"]) => M,
  exec: Metric.Bench.Exec<M, R>,
): Metric.Bench.Exec<G["Type"], R> => {
  const mapTrail = (trail: TrailResult<G["Type"]>): TrailResult<M> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  const mapResults = (
    results: Metric.Bench.BenchResult<G["Type"]>,
  ): Metric.Bench.BenchResult<M> => {
    const mapped: Record<Task.ID, TrailResult<M>[]> = {};
    for (const [taskId, trails] of Object.entries(results)) {
      mapped[taskId] = trails.map(mapTrail);
    }
    return mapped;
  };

  return (results, delta, prev) => {
    const [taskId, trails] = delta;
    return exec(mapResults(results), [taskId, trails.map(mapTrail)], prev);
  };
};

export const mapMetric =
  <G extends Grade.AnyResult, M, MR extends Schema.Json>(
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

export const trajMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench<T>, E, R>,
  ): Effect.Effect<Bench<T>, E | BenchError, R> =>
    Effect.flatMap(
      bench,
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
    );

const mapTrajExec = <R extends Schema.Json>(
  mapper: (state: Metric.Traj.State, delta: Metric.Traj.Delta) => Metric.Traj.State,
  exec: Metric.Traj.Exec<R>,
): Metric.Traj.Exec<R> => {
  return (state, delta, prev) => exec(mapper(state, delta), delta, prev);
};

export const mapTrajMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    taskId: Task.ID,
    mapper: (state: Metric.Traj.State, delta: Metric.Traj.Delta) => Metric.Traj.State,
    exec: Metric.Traj.Exec<R>,
    options: Omit<Metric.Traj.Options<R>, "exec"> = {},
  ) =>
  <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench<T>, E, R>,
  ): Effect.Effect<Bench<T>, E | BenchError, R> =>
    Effect.flatMap(
      bench,
      Effect.fn(function* (bench) {
        if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
          return yield* Effect.fail(BenchError.taskNotFound(taskId));
        }

        const metric = yield* Metric.Traj.make({
          ...options,
          exec: mapTrajExec(mapper, exec),
        }).pipe(Effect.mapError(BenchError.init));

        return produce(bench, (draft) => {
          for (const task of draft.tasks) {
            if (task.metadata.id === taskId) {
              task.trajMetrics.push(castDraft(metric));
              break;
            }
          }
        });
      }),
    );

export const schedMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Sched.Exec<R>,
    options: Omit<Metric.Sched.Options<R>, "exec"> = {},
  ) =>
  <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench<T>, E, R>,
  ): Effect.Effect<Bench<T>, E | BenchError, R> =>
    Effect.flatMap(
      bench,
      Effect.fn(function* (bench) {
        if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
          return yield* Effect.fail(BenchError.taskNotFound(taskId));
        }

        const metric = yield* Metric.Sched.make({ ...options, exec }).pipe(
          Effect.mapError(BenchError.init),
        );

        return produce(bench, (draft) => {
          for (const task of draft.tasks) {
            if (task.metadata.id === taskId) {
              task.schedMetrics.push(castDraft(metric));
              break;
            }
          }
        });
      }),
    );

const mapSchedExec = <R extends Schema.Json>(
  mapper: (sandbox: Sandbox.ReadonlySandboxPromise) => Sandbox.ReadonlySandboxPromise,
  exec: Metric.Sched.Exec<R>,
): Metric.Sched.Exec<R> => {
  return (sandbox, prev) => exec(mapper(sandbox), prev);
};

export const mapSchedMetric =
  <R extends Schema.Json = Schema.JsonObject>(
    taskId: Task.ID,
    mapper: (sandbox: Sandbox.ReadonlySandboxPromise) => Sandbox.ReadonlySandboxPromise,
    exec: Metric.Sched.Exec<R>,
    options: Omit<Metric.Sched.Options<R>, "exec"> = {},
  ) =>
  <T extends Task.AnyTask, E, R>(
    bench: Effect.Effect<Bench<T>, E, R>,
  ): Effect.Effect<Bench<T>, E | BenchError, R> =>
    Effect.flatMap(
      bench,
      Effect.fn(function* (bench) {
        if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
          return yield* Effect.fail(BenchError.taskNotFound(taskId));
        }

        const metric = yield* Metric.Sched.make({
          ...options,
          exec: mapSchedExec(mapper, exec),
        }).pipe(Effect.mapError(BenchError.init));

        return produce(bench, (draft) => {
          for (const task of draft.tasks) {
            if (task.metadata.id === taskId) {
              task.schedMetrics.push(castDraft(metric));
              break;
            }
          }
        });
      }),
    );
