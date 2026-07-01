import { Effect } from "effect";
import { produce } from "immer";
import * as Task from "../task/index.ts";
import * as TrajMetric from "./traj.ts";
import * as TaskMetric from "./task.ts";
import * as BenchMetric from "./bench.ts";
import type { Chart, Format } from "./chart.ts";

export type Metrics<G extends Task.Grader = Task.Grader, TAM = TaskMetric.Metric> = Readonly<{
  trajectory: Array<TrajMetric.Metric>;
  task: Array<TaskMetric.Metric>;
  benchmark: Array<BenchMetric.Metric>;
  format: Array<Chart>;
}> & { _G?: G; _TAM?: TAM };

export type Builder<G extends Task.Grader, TAM = never> = Effect.Effect<Metrics<G, TAM>>;

export const init = <T extends Task.Task>(): Builder<Task.GraderOf<T>> =>
  Effect.succeed({
    trajectory: [],
    task: [],
    benchmark: [],
    format: [],
  });

export const withTrajReduce =
  <N extends string, R>(name: N, init: R, exec: TrajMetric.ReduceFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.reduce(name, init, exec) as TrajMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withTrajEach =
  <N extends string, R>(name: N, exec: TrajMetric.EachFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.each(name, exec) as TrajMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withTraj =
  <N extends string, R>(name: N, exec: TrajMetric.AllFn<R>, format?: Format<R>) =>
  <G extends Task.Grader, TAM>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.trajectory.push(TrajMetric.all(name, exec) as TrajMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withTaskReduce =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    init: R,
    exec: TaskMetric.ReduceFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.reduce(name, init, exec) as TaskMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withTaskEach =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.EachFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.each(name, exec) as TaskMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withTask =
  <G extends Task.Grader, N extends string, R>(
    name: N,
    exec: TaskMetric.AllFn<G, R>,
    format?: Format<R>,
  ) =>
  <TAM>(builder: Builder<G, TAM>): Builder<G, TAM | TaskMetric.Metric<G, N, R>> =>
    Effect.map(builder, (metrics) =>
      produce(metrics, (draft) => {
        draft.task.push(TaskMetric.all(name, exec) as TaskMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withBenchReduce =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    init: R,
    exec: BenchMetric.ReduceFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.reduce(name, init, exec) as BenchMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withBenchEach =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.EachFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.each(name, exec) as BenchMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export const withBenchmark =
  <TAM extends TaskMetric.Metric, N extends string, R>(
    name: N,
    exec: BenchMetric.AllFn<TAM, R>,
    format?: Format<R>,
  ) =>
  <G extends Task.Grader>(build: Builder<G, TAM>): Builder<G, TAM> =>
    Effect.map(build, (metrics) =>
      produce(metrics, (draft) => {
        draft.benchmark.push(BenchMetric.all(name, exec) as BenchMetric.Metric);
        draft.format.push({ name, format } as Chart);
      }),
    );

export type MetricResult<
  TAM = TaskMetric.Metric,
  TRAM = TrajMetric.Metric,
  BAM = BenchMetric.Metric,
> = TaskMetric.Result<TAM> & TrajMetric.Result<TRAM> & BenchMetric.Result<BAM>;
