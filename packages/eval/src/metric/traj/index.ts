import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Array as Arr, Effect, Match, Option, Ref, Schema, Stream } from "effect";
import type { SchemaError } from "effect/SchemaError";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import { Result, type StreamResult } from "../result.ts";
import * as When from "../when/index.ts";
import { MetricError } from "../error.ts";

export type Context = Sandbox.ReadonlySandboxPromise &
  Readonly<{ prompt: Prompt.Prompt; response: Prompt.Parts; trajectory: Prompt.Trajectory }>;

/**
 * Computes a trajectory metric whenever its trigger matches.
 *
 * @param context The sandbox, previous trajectory, and current response parts observed so far.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<R extends Schema.Json = Schema.Json> = (
  context: Context,
  prev: R | null,
) => R | Promise<R>;

export type Metric<R extends Schema.Json = Schema.Json> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  when: When.When;
}>;

export type Options<R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<R>;
  when?: When.When;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.Json = Schema.Json>(options: Options<R>) {
  const { exec, when = When.traj(When.part()), chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return { exec, when, chart, metadata } satisfies Metric<R>;
});

// const execMetric = Effect.fn("metric/traj/execMetric")(function* ({
//   metric,
//   context,
//   prev,
//   stateRef,
// }: {
//   metric: Metric;
//   context: Context;
//   prev: Result | null;
//   stateRef: Ref.Ref<ReadonlyMap<Metric, Result>>;
// }): Effect.fn.Return<StreamResult, MetricError> {
//   const rawResult = yield* Effect.tryPromise(() =>
//     Promise.resolve(metric.exec(context, prev)),
//   ).pipe(Effect.mapError(MetricError.exec(metric.metadata.id)));
//   const result = yield* Schema.decodeEffect(Result)(rawResult).pipe(
//     Effect.mapError(MetricError.result(metric.metadata.id)),
//     Effect.as(rawResult),
//   );

//   yield* Ref.update(stateRef, (state) => new Map(state).set(metric, result));

//   const chart = yield* Effect.try(() => (metric.chart ? metric.chart(result) : null)).pipe(
//     Effect.mapError(MetricError.chart(metric.metadata.id)),
//   );

//   return {
//     id: metric.metadata.id,
//     result,
//     chart,
//   } satisfies StreamResult;
// });

// const runMetric = Effect.fn("metric/traj/runMetric")(function* (
//   metric: Metric,
//   pred: When.Pred | undefined,
//   context: Context,
//   stateRef: Ref.Ref<ReadonlyMap<Metric, Result>>,
// ): Effect.fn.Return<Option.Option<StreamResult>, MetricError> {
//   const matches = yield* Effect.tryPromise(() => Promise.resolve(pred?.(context) ?? true)).pipe(
//     Effect.mapError(MetricError.exec(metric.metadata.id)),
//   );

//   if (!matches) {
//     return Option.none();
//   }

//   const state = yield* Ref.get(stateRef);
//   const prev = state.get(metric) ?? null;
//   return Option.some(yield* execMetric({ metric, context, prev, stateRef }));
// });

export const createRunner = Effect.fn(function* ({
  metric,
  sandbox,
  trajectory,
}: {
  metric: Metric;
  sandbox: Sandbox.SandboxPromise;
  trajectory: Ref.Ref<Prompt.Trajectory>;
}) {
  const prevRef = yield* Ref.make<Result | null>(null);

  return Effect.fn(function* () {});
});

// export type RunOptions = Readonly<{
//   metrics: ReadonlyArray<Metric>;
//   sandbox: Sandbox.SandboxPromise;
//   prevTrajectory: Prompt.Trajectory;
// }>;

// export const run = ({ metrics, sandbox, prevTrajectory }: RunOptions) =>
//   Effect.fn(
//     function* <E, R>(
//       stream: Prompt.PartEncodedStream<E, R>,
//     ): Effect.fn.Return<Stream.Stream<StreamResult, MetricError | SchemaError | E, R>> {
//       const partsRef = yield* Ref.make<Prompt.Parts>([]);
//       const state = yield* Ref.make<ReadonlyMap<Metric, Result>>(new Map());
//       const runPart = (metric: Metric, part: Prompt.Part, parts: Prompt.Parts) =>
//         Match.valueTags(metric.when, {
//           Traj: (when) =>
//             Effect.try(() => when.trajPred(part, parts)).pipe(
//               Effect.mapError(MetricError.exec(metric.metadata.id)),
//               Effect.flatMap((matches) =>
//                 matches
//                   ? runMetric(metric, when.pred, { ...sandbox, parts, prevTrajectory }, state)
//                   : Effect.succeed(Option.none()),
//               ),
//             ),
//           Schedule: () => Effect.succeed(Option.none()),
//         });

//       const scheduleStream = (metric: Metric) =>
//         Match.valueTags(metric.when, {
//           Traj: () => Stream.empty,
//           Schedule: (when) =>
//             Stream.fromSchedule(when.schedule).pipe(
//               Stream.mapEffect(() =>
//                 Ref.get(partsRef).pipe(
//                   Effect.flatMap((parts) =>
//                     runMetric(metric, when.pred, { ...sandbox, parts, prevTrajectory }, state),
//                   ),
//                 ),
//               ),
//               Stream.map(Option.toArray),
//               Stream.flatMap(Stream.fromIterable),
//             ),
//         });

//       // Consume the trajectory once and dispatch each metric when its trigger is available.
//       const trajResults = stream.pipe(
//         Stream.mapEffect((encoded) => Schema.decodeEffect(Prompt.Part)(encoded)),
//         Stream.mapEffect((part) =>
//           Ref.updateAndGet(partsRef, (parts) => [...parts, part]).pipe(
//             Effect.flatMap((parts) =>
//               Effect.forEach(metrics, (metric) => runPart(metric, part, parts), {
//                 concurrency: "unbounded",
//               }),
//             ),
//             Effect.map(Arr.getSomes),
//           ),
//         ),
//         Stream.flatMap(Stream.fromIterable),
//       );

//       // Scheduled metrics have independent clocks; merging with trajectory results bounds their lifetime.
//       const scheduleResults = Stream.mergeAll(metrics.map(scheduleStream), {
//         concurrency: "unbounded",
//       });

//       return Stream.merge(trajResults, scheduleResults, {
//         // The trajectory owns the lifecycle; stop polling when it completes or fails.
//         haltStrategy: "left",
//       });
//     },
//     (effect) => effect.pipe(Stream.unwrap),
//   );

export * from "./builtin/index.ts";
