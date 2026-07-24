import * as Chart from "#/chart/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, SynchronizedRef } from "effect";
import { castDraft, produce } from "immer";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

type Results = ReadonlyArray<TrailResult>;
type Accumulator = Readonly<{
  results: Results;
  prev: Readonly<Record<string, Schema.JsonObject>>;
}>;

const MetricResult = Schema.Record(Schema.String, Schema.Json);
type MetricResult = typeof MetricResult.Type;

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (
  results: Results,
  delta: TrailResult,
  prev: R | null,
) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Options<R>,
) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options);
  return { exec, chart, metadata } satisfies Metric<R>;
});

export const makeAccumulator = Effect.fn("metric/task/makeAccumulator")(function* (
  metrics: ReadonlyArray<Metric>,
) {
  const accumulator = yield* SynchronizedRef.make<Accumulator>({ results: [], prev: {} });

  return Effect.fn("metric/task/accumulate")(function* (delta: TrailResult) {
    if (metrics.length === 0) {
      return [];
    }

    return yield* SynchronizedRef.modifyEffect(
      accumulator,
      Effect.fn(function* (state) {
        const resultsByMetric = yield* Effect.forEach(metrics, (metric) =>
          Effect.tryPromise(() =>
            metric.exec(state.results, delta, state.prev[metric.metadata.id] ?? null),
          ).pipe(
            Effect.flatMap(Schema.decodeEffect(MetricResult)),
            Effect.map((result) => [metric, result] satisfies readonly [Metric, MetricResult]),
          ),
        );

        return [
          resultsByMetric,
          produce(state, (draft) => {
            draft.results.push(castDraft(delta));
            for (const [metric, result] of resultsByMetric) {
              draft.prev[metric.metadata.id] = castDraft(result);
            }
          }),
        ] satisfies readonly [typeof resultsByMetric, Accumulator];
      }),
    );
  });
});
