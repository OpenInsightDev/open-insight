import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Ref, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import { MetricError } from "../error.ts";
import type { Prompt } from "@open-insight/core/internal";
import { Response } from "effect/unstable/ai";

export type SessionResult = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailResult<G = unknown> = Readonly<{
  grade: G;
  sessions: ReadonlyArray<SessionResult>;
}>;

export type TaskResult<G = unknown> = ReadonlyArray<TrailResult<G>>;

/**
 * Computes a task metric whenever a new trail result is available.
 *
 * @param results All trail results collected so far, including the current `delta`.
 * @param delta The trail result that triggered this computation.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  results: TaskResult<G>,
  delta: TrailResult<G>,
  prev: R | null,
) => R | Promise<R>;

export type Metric<G = unknown, R extends Schema.Json = Schema.Json> = Readonly<{
  exec: BivariantFn<Exec<G, R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options<G = unknown, R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<G, R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <G = unknown, R extends Schema.Json = Schema.Json>(
  options: Options<G, R>,
) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return { exec, chart, metadata } satisfies Metric<G, R>;
});

export const creates = Effect.fn(function* (metrics: ReadonlyArray<Metric>) {
  const taskResultRef = yield* Ref.make<ReadonlyArray<TrailResult>>([]);

  const create = Effect.fn(function* (metric: Metric) {
    const prevRef = yield* Ref.make<unknown | null>(null);

    return Effect.fn(function* (trailResult: TrailResult) {});
  });

  return Effect.fn(function* (trailResult: TrailResult) {});
});

// export const run = Effect.fn("metric/task/run")(function* <G, R extends Schema.Json>(
//   metric: Metric<G, R>,
// ) {
//   const state = yield* Ref.make<
//     Readonly<{
//       results: ReadonlyArray<TrailResult<G>>;
//       prev: R | null;
//     }>
//   >({ results: [], prev: null });

//   return Effect.fn(function* (delta: TrailResult<G>): Effect.fn.Return<StreamResult, MetricError> {
//     const current = yield* Ref.get(state);
//     const results = [...current.results, delta];

//     const rawResult = yield* Effect.tryPromise(() =>
//       Promise.resolve(metric.exec(results, delta, current.prev)),
//     ).pipe(Effect.mapError(MetricError.exec(metric.metadata.id)));
//     const result = yield* Schema.decodeEffect(Result)(rawResult).pipe(
//       Effect.mapError(MetricError.result(metric.metadata.id)),
//       Effect.as(rawResult),
//     );

//     yield* Ref.set(state, { results, prev: result });

//     const chart = yield* Effect.try(() => (metric.chart ? metric.chart(result) : null)).pipe(
//       Effect.mapError(MetricError.chart(metric.metadata.id)),
//     );

//     return {
//       id: metric.metadata.id,
//       result,
//       chart,
//     } satisfies StreamResult;
//   });
// });

// export * from "./builtin/index.ts";
