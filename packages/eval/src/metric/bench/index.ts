import * as Chart from "#/chart/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "#/task/index.ts";
import { Effect, Ref, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import { Result, type StreamResult } from "../result.ts";
import { MetricError } from "../error.ts";

export type Delta<G = unknown> = TrailResult<G> & Readonly<{ task: Task.ID }>;
export type Results<G = unknown> = Readonly<Record<Task.ID, ReadonlyArray<TrailResult<G>>>>;

/**
 * Computes a benchmark metric whenever a new task trail result is available.
 *
 * @param results All benchmark results collected so far, including the current `delta`.
 * @param delta The task trail result that triggered this computation.
 * @param prev The previous output of this metric, or `null` on its first execution.
 *
 * Note that the function needs to be explicitly return-type annotated.
 */
export type Exec<G = unknown, R extends Schema.JsonObject = Schema.JsonObject> = (
  results: Results<G>,
  delta: Delta<G>,
  prev: R | null,
) => R | Promise<R>;

export type Metric<G = unknown, R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: BivariantFn<Exec<G, R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options<G = unknown, R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<G, R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <
  G = unknown,
  R extends Schema.JsonObject = Schema.JsonObject,
>(options: Options<G, R>) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return { exec, chart, metadata } satisfies Metric<G, R>;
});

export const run = Effect.fn("metric/bench/run")(function* <G, R extends Schema.JsonObject>(
  metric: Metric<G, R>,
) {
  const state = yield* Ref.make<
    Readonly<{
      results: Results<G>;
      prev: R | null;
    }>
  >({ results: {}, prev: null });

  return Effect.fn(function* (delta: Delta<G>): Effect.fn.Return<StreamResult, MetricError> {
    const current = yield* Ref.get(state);
    const results = {
      ...current.results,
      [delta.task]: [...(current.results[delta.task] ?? []), delta],
    };

    const rawResult = yield* Effect.tryPromise(() =>
      Promise.resolve(metric.exec(results, delta, current.prev)),
    ).pipe(Effect.mapError(MetricError.exec(metric.metadata.id)));
    const result = yield* Schema.decodeEffect(Result)(rawResult).pipe(
      Effect.mapError(MetricError.result(metric.metadata.id)),
      Effect.as(rawResult),
    );

    yield* Ref.set(state, { results, prev: result });

    const chart = yield* Effect.try(() => (metric.chart ? metric.chart(result) : null)).pipe(
      Effect.mapError(MetricError.chart(metric.metadata.id)),
    );

    return {
      id: metric.metadata.id,
      result,
      chart,
    } satisfies StreamResult;
  });
});

export * from "./builtin/index.ts";
