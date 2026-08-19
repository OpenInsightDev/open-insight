import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";
import type { TrailResult as EventTrailResult } from "#/event/result.ts";

export type TrailResult<G = unknown> = EventTrailResult<G>;
export type TrailResults<G = unknown> = ReadonlyArray<TrailResult<G>>;

export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  results: TrailResults<G>,
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

export const makeStream =
  <G = unknown, E = never, R = never>(trailResultStream: Stream.Stream<TrailResult<G>, E, R>) =>
  <M extends Schema.Json>({
    exec,
    metadata,
    chart,
  }: Metric<G, M>): Stream.Stream<Result, E | MetricError, R> =>
    trailResultStream.pipe(
      Stream.mapAccumEffect(
        () => ({ results: [] as TrailResults<G>, prev: null as M | null }),
        (state, delta) => {
          const results = [...state.results, delta];

          return Effect.tryPromise({
            try: () => Promise.resolve(exec(results, delta, state.prev)),
            catch: MetricError.exec(metadata.id),
          }).pipe(
            Effect.map(
              (next) =>
                [
                  { results, prev: next },
                  [
                    Result.make({
                      metricID: metadata.id,
                      value: next,
                      chart: chart?.(next) ?? null,
                    }),
                  ],
                ] as const,
            ),
          );
        },
      ),
    );
