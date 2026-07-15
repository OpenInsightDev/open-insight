// import { Effect } from "effect";
// import { produce } from "immer";
// import type * as Grade from "#/grade/index.ts";
// import * as Task from "../task/index.ts";
// import * as TrajMetric from "./traj/index.ts";
// import * as TaskMetric from "./task/index.ts";
// import * as BenchMetric from "./bench/index.ts";
// import type { Metadata } from "./schema.ts";

// export type Metrics<
//   G extends Grade.Result = Grade.Result,
//   TRM extends TrajMetric.Metric = any,
//   TAM extends TaskMetric.Metric = any,
//   BM extends BenchMetric.Metric = any,
// > = Readonly<{
//   trajectory: Array<TRM>;
//   task: Array<TAM>;
//   benchmark: Array<BM>;
//   metadata: Array<Metadata>;
// }> & { _G?: G; _TRM?: TRM; _TAM?: TAM; _BM?: BM };

// export type ResultOf<M> =
//   M extends Metrics<infer _, infer TRM, infer TAM, infer BM>
//     ? TrajMetric.Result<TRM> & TaskMetric.Result<TAM> & BenchMetric.Result<BM>
//     : never;

// export type Builder<
//   G extends Grade.Result,
//   TRM extends TrajMetric.Metric = never,
//   TAM extends TaskMetric.Metric = never,
//   BM extends BenchMetric.Metric = never,
// > = Effect.Effect<Metrics<G, TRM, TAM, BM>>;

// export const init = <T extends Task.Task>(): Builder<Task.GradeResultOf<T>> =>
//   Effect.succeed({
//     trajectory: [],
//     task: [],
//     benchmark: [],
//     metadata: [],
//   });

// export const withTrajReduce =
//   <N extends string, R>(name: N, init: R, exec: TrajMetric.ReduceFn<R>) =>
//   <
//     G extends Grade.Result,
//     TRM extends TrajMetric.Metric,
//     TAM extends TaskMetric.Metric,
//     BM extends BenchMetric.Metric,
//   >(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM | TrajMetric.Metric<N, R>, TAM, BM> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.trajectory as Array<TRM | TrajMetric.Metric<N, R>>).push(
//             TrajMetric.reduce(name, init, exec),
//           );
//           draft.metadata.push({ name, type: "Trajectory", variant: "Reduce" });
//         }) as Metrics<G, TRM | TrajMetric.Metric<N, R>, TAM, BM>,
//     );

// export const withTraj =
//   <N extends string, R>(name: N, exec: TrajMetric.EachFn<R>) =>
//   <
//     G extends Grade.Result,
//     TRM extends TrajMetric.Metric,
//     TAM extends TaskMetric.Metric,
//     BM extends BenchMetric.Metric,
//   >(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM | TrajMetric.Metric<N, R>, TAM, BM> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.trajectory as Array<TRM | TrajMetric.Metric<N, R>>).push(
//             TrajMetric.each(name, exec),
//           );
//           draft.metadata.push({ name, type: "Trajectory", variant: "Each" });
//         }) as Metrics<G, TRM | TrajMetric.Metric<N, R>, TAM, BM>,
//     );

// export const withTrajAll =
//   <N extends string, R>(name: N, exec: TrajMetric.AllFn<R>) =>
//   <
//     G extends Grade.Result,
//     TRM extends TrajMetric.Metric,
//     TAM extends TaskMetric.Metric,
//     BM extends BenchMetric.Metric,
//   >(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM | TrajMetric.Metric<N, R>, TAM, BM> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.trajectory as Array<TRM | TrajMetric.Metric<N, R>>).push(
//             TrajMetric.all(name, exec),
//           );
//           draft.metadata.push({ name, type: "Trajectory", variant: "All" });
//         }) as Metrics<G, TRM | TrajMetric.Metric<N, R>, TAM, BM>,
//     );

// export const withTaskReduce =
//   <G extends Grade.Result, N extends string, R>(
//     name: N,
//     init: R,
//     exec: TaskMetric.ReduceFn<G, R>,
//   ) =>
//   <TRM extends TrajMetric.Metric, TAM extends TaskMetric.Metric, BM extends BenchMetric.Metric>(
//     builder: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM | TaskMetric.Metric<N, R, "Reduce", G>, BM> =>
//     Effect.map(
//       builder,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.task as Array<TAM | TaskMetric.Metric<N, R, "Reduce", G>>).push(
//             TaskMetric.reduce(name, init, exec),
//           );
//           draft.metadata.push({ name, type: "Task", variant: "Reduce" });
//         }) as Metrics<G, TRM, TAM | TaskMetric.Metric<N, R, "Reduce", G>, BM>,
//     );

// export const withTask =
//   <G extends Grade.Result, N extends string, R>(name: N, exec: TaskMetric.EachFn<G, R>) =>
//   <TRM extends TrajMetric.Metric, TAM extends TaskMetric.Metric, BM extends BenchMetric.Metric>(
//     builder: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM | TaskMetric.Metric<N, R, "Each", G>, BM> =>
//     Effect.map(
//       builder,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.task as Array<TAM | TaskMetric.Metric<N, R, "Each", G>>).push(
//             TaskMetric.each(name, exec),
//           );
//           draft.metadata.push({ name, type: "Task", variant: "Each" });
//         }) as Metrics<G, TRM, TAM | TaskMetric.Metric<N, R, "Each", G>, BM>,
//     );

// export const withTaskAll =
//   <G extends Grade.Result, N extends string, R>(name: N, exec: TaskMetric.AllFn<G, R>) =>
//   <TRM extends TrajMetric.Metric, TAM extends TaskMetric.Metric, BM extends BenchMetric.Metric>(
//     builder: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM | TaskMetric.Metric<N, R, "All", G>, BM> =>
//     Effect.map(
//       builder,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.task as Array<TAM | TaskMetric.Metric<N, R, "All", G>>).push(
//             TaskMetric.all(name, exec),
//           );
//           draft.metadata.push({ name, type: "Task", variant: "All" });
//         }) as Metrics<G, TRM, TAM | TaskMetric.Metric<N, R, "All", G>, BM>,
//     );

// export const withBenchReduce =
//   <N extends string, TAM extends TaskMetric.Metric, R>(
//     name: N,
//     init: R,
//     exec: BenchMetric.ReduceFn<TAM, R>,
//   ) =>
//   <G extends Grade.Result, TRM extends TrajMetric.Metric, BM extends BenchMetric.Metric>(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.benchmark as Array<BM | BenchMetric.Metric<TAM, N, R>>).push(
//             BenchMetric.reduce(name, init, exec as BenchMetric.ReduceFn<TAM, R>),
//           );
//           draft.metadata.push({ name, type: "Bench", variant: "Reduce" });
//         }) as Metrics<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>>,
//     );

// export const withBench =
//   <N extends string, TAM extends TaskMetric.Metric, R>(name: N, exec: BenchMetric.EachFn<TAM, R>) =>
//   <G extends Grade.Result, TRM extends TrajMetric.Metric, BM extends BenchMetric.Metric>(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.benchmark as Array<BM | BenchMetric.Metric<TAM, N, R>>).push(
//             BenchMetric.each(name, exec as BenchMetric.EachFn<TAM, R>),
//           );
//           draft.metadata.push({ name, type: "Bench", variant: "Each" });
//         }) as Metrics<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>>,
//     );

// export const withBenchAll =
//   <N extends string, TAM extends TaskMetric.Metric, R>(name: N, exec: BenchMetric.AllFn<TAM, R>) =>
//   <G extends Grade.Result, TRM extends TrajMetric.Metric, BM extends BenchMetric.Metric>(
//     build: Builder<G, TRM, TAM, BM>,
//   ): Builder<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>> =>
//     Effect.map(
//       build,
//       (metrics) =>
//         produce(metrics, (draft) => {
//           (draft.benchmark as Array<BM | BenchMetric.Metric<TAM, N, R>>).push(
//             BenchMetric.all(name, exec as BenchMetric.AllFn<TAM, R>),
//           );
//           draft.metadata.push({ name, type: "Bench", variant: "All" });
//         }) as Metrics<G, TRM, TAM, BM | BenchMetric.Metric<TAM, N, R>>,
//     );

import * as Traj from "./traj.ts";

export type Metrics<TRM, TAM, BM> = Readonly<{
  traj: TRM;
  task: TAM;
  bench: BM;
}> & { _TRM?: TRM; _TAM?: TAM; _BM?: BM };
