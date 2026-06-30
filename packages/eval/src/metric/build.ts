import { Effect } from "effect";
import * as Task from "../task/index.ts";
import * as TrajMetric from "./traj/index.ts";
import * as TaskMetric from "./task/index.ts";
import * as BenchMetric from "./bench/index.ts";

export type Metrics<G extends Task.Grader = Task.Grader, TAM = TaskMetric.Metric> = Readonly<{
  trajectory: Array<TrajMetric.Metric>;
  task: Array<TaskMetric.Metric>;
  benchmark: Array<BenchMetric.Metric>;
}> & { _G?: G; _TAM?: TAM };

export type Builder<G extends Task.Grader, TAM> = Effect.Effect<Metrics<G, TAM>>;

export const init = <T extends Task.Task>(): Builder<Task.GraderOf<T>, never> =>
  Effect.succeed({
    trajectory: [],
    task: [],
    benchmark: [],
  });

export const withTrajReduce =
  <N extends string, R>(name: N, init: R, exec: TrajMetric.ReduceFn<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.reduce(name, init, exec) as TrajMetric.Metric],
    }));

export const withTrajEach =
  <N extends string, R>(name: N, exec: TrajMetric.EachFn<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.each(name, exec) as TrajMetric.Metric],
    }));

export const withTraj =
  <N extends string, R>(name: N, exec: TrajMetric.AllFn<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      trajectory: [...metrics.trajectory, TrajMetric.all(name, exec) as TrajMetric.Metric],
    }));

export const withTaskReduce =
  <G extends Task.Grader, N extends string, R>(name: N, init: R, exec: TaskMetric.ReduceFn<G, R>) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.reduce(name, init, exec) as TaskMetric.Metric],
    }));

export const withTaskEach =
  <G extends Task.Grader, N extends string, R>(name: N, exec: TaskMetric.EachFn<G, R>) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.each(name, exec) as TaskMetric.Metric],
    }));

export const withTask =
  <G extends Task.Grader, N extends string, R>(name: N, exec: TaskMetric.AllFn<G, R>) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) => ({
      ...metrics,
      task: [...metrics.task, TaskMetric.all(name, exec) as TaskMetric.Metric],
    }));

export const withBenchReduce =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    init: R,
    exec: BenchMetric.ReduceFn<TAM, R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.reduce(name, init, exec) as BenchMetric.Metric],
    }));

export const withBenchEach =
  <TAM extends TaskMetric.Metric, N extends string, R>(name: N, exec: BenchMetric.EachFn<TAM, R>) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.each(name, exec) as BenchMetric.Metric],
    }));

export const withBenchmark =
  <TAM extends TaskMetric.Metric, N extends string, R>(name: N, exec: BenchMetric.AllFn<TAM, R>) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) => ({
      ...metrics,
      benchmark: [...metrics.benchmark, BenchMetric.all(name, exec) as BenchMetric.Metric],
    }));
