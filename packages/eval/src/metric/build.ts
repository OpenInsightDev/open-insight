import { Effect } from "effect";
import { produce } from "immer";
import * as Task from "../task/index.ts";
import * as TrajMetric from "./traj/index.ts";
import * as TaskMetric from "./task/index.ts";
import * as BenchMetric from "./bench/index.ts";
import type { Format, Exec } from "./chart.ts";
import type { Metadata } from "./schema.ts";

export type Metrics<G extends Task.Grader = Task.Grader, TAM = TaskMetric.Metric> = Readonly<{
  trajectory: Array<TrajMetric.Metric>;
  task: Array<TaskMetric.Metric>;
  benchmark: Array<BenchMetric.Metric>;
  format: Array<Format>;
  metadata: Array<Metadata>;
}> & { _G?: G; _TAM?: TAM };

export type Builder<G extends Task.Grader, TAM = never> = Effect.Effect<Metrics<G, TAM>>;

export const init = <T extends Task.Task>(): Builder<Task.GraderOf<T>> =>
  Effect.succeed({
    trajectory: [],
    task: [],
    benchmark: [],
    format: [],
    metadata: [],
  });

export const withTrajReduce =
  <N extends string, R>(name: N, init: R, exec: TrajMetric.ReduceFn<R>, format?: Exec<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.reduce(name, init, exec) as TrajMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Trajectory", variant: "Reduce" });
      }),
    );

export const withTrajEach =
  <N extends string, R>(name: N, exec: TrajMetric.EachFn<R>, format?: Exec<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.each(name, exec) as TrajMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Trajectory", variant: "Each" });
      }),
    );

export const withTraj =
  <N extends string, R>(name: N, exec: TrajMetric.AllFn<R>, format?: Exec<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.all(name, exec) as TrajMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Trajectory", variant: "All" });
      }),
    );

export const withTaskReduce =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    init: R,
    exec: TaskMetric.ReduceFn<G, R>,
    format?: Exec<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.reduce(name, init, exec) as TaskMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Task", variant: "Reduce" });
      }),
    );

export const withTaskEach =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.EachFn<G, R>,
    format?: Exec<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.each(name, exec) as TaskMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Task", variant: "Each" });
      }),
    );

export const withTask =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.AllFn<G, R>,
    format?: Exec<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.all(name, exec) as TaskMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Task", variant: "All" });
      }),
    );

export const withBenchReduce =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    init: R,
    exec: BenchMetric.ReduceFn<TAM, R>,
    format?: Exec<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.reduce(name, init, exec) as BenchMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Benchmark", variant: "Reduce" });
      }),
    );

export const withBenchEach =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.EachFn<TAM, R>,
    format?: Exec<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.each(name, exec) as BenchMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Benchmark", variant: "Each" });
      }),
    );

export const withBenchmark =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.AllFn<TAM, R>,
    format?: Exec<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.all(name, exec) as BenchMetric.Metric);
        if (format) {
          draft.format.push({ name, format: format as Exec });
        }
        draft.metadata.push({ name, type: "Benchmark", variant: "All" });
      }),
    );
