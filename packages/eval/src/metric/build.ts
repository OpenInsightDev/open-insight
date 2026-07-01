import { Effect } from "effect";
import * as Task from "../task/index.ts";
import * as TrajMetric from "./traj/index.ts";
import * as TaskMetric from "./task/index.ts";
import * as BenchMetric from "./bench/index.ts";
import type { Chart, Format } from "./chart.ts";

export type Metrics<
  G extends Task.Grader = Task.Grader,
  TAM = TaskMetric.Metric,
  RM = never,
> = Readonly<{
  trajectory: Array<TrajMetric.Metric>;
  task: Array<TaskMetric.Metric>;
  benchmark: Array<BenchMetric.Metric>;
  format: Array<Chart>;
}> & { _G?: G; _TAM?: TAM; _RM?: RM };

export type Builder<G extends Task.Grader, TAM, RM = never> = Effect.Effect<Metrics<G, TAM, RM>>;

export const init = <T extends Task.Task>(): Builder<Task.GraderOf<T>, never> =>
  Effect.succeed({
    trajectory: [],
    task: [],
    benchmark: [],
    format: [],
  });

export const withTrajReduce =
  <N extends string, R>(name: N, init: R, exec: TrajMetric.ReduceFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM, RM>(
    build: Builder<G, TAM, RM>,
  ): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.reduce(name, init, exec) as TrajMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withTrajEach =
  <N extends string, R>(name: N, exec: TrajMetric.EachFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM, RM>(
    build: Builder<G, TAM, RM>,
  ): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.each(name, exec) as TrajMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withTraj =
  <N extends string, R>(name: N, exec: TrajMetric.AllFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM, RM>(
    build: Builder<G, TAM, RM>,
  ): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.all(name, exec) as TrajMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withTaskReduce =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    init: R,
    exec: TaskMetric.ReduceFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM, RM>(
    builder: Builder<G, TAM, RM>,
  ): Builder<G, TAM | TaskMetric.Metric<G, N, R>, RM | Record<N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.reduce(name, init, exec) as TaskMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withTaskEach =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.EachFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM, RM>(
    builder: Builder<G, TAM, RM>,
  ): Builder<G, TAM | TaskMetric.Metric<G, N, R>, RM | Record<N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.each(name, exec) as TaskMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withTask =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.AllFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM, RM>(
    builder: Builder<G, TAM, RM>,
  ): Builder<G, TAM | TaskMetric.Metric<G, N, R>, RM | Record<N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.all(name, exec) as TaskMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withBenchReduce =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    init: R,
    exec: BenchMetric.ReduceFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader, RM>(build: Builder<G, TAM, RM>): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.reduce(name, init, exec) as BenchMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withBenchEach =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.EachFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader, RM>(build: Builder<G, TAM, RM>): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.each(name, exec) as BenchMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export const withBenchmark =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.AllFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader, RM>(build: Builder<G, TAM, RM>): Builder<G, TAM, RM | Record<N, R>> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.all(name, exec) as BenchMetric.Metric],
      format: [...metrics.format, { name, format }] as Chart[],
    }));

export type MetricResult<
  TAM = TaskMetric.Metric,
  TRAM = TrajMetric.Metric,
  BAM = BenchMetric.Metric,
> = TaskMetric.Result<TAM> & TrajMetric.Result<TRAM> & BenchMetric.Result<BAM>;
