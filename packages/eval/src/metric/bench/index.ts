import * as Chart from "#/chart/index.ts";
import * as Task from "#/task/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";
import type { TrailResults } from "../task/index.ts";

export type BenchResult<G = unknown> = Readonly<Record<Task.ID, TrailResults<G>>>;
export type Delta<G = unknown> = [Task.ID, TrailResults<G>];

/**
 * Computes a benchmark metric whenever a new task result is available.
 *
 * @param results All benchmark results collected so far, including the current `delta`.
 * @param delta The task result that triggered this computation.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  results: BenchResult<G>,
  delta: Delta,
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
  <G = unknown, E = never, R = never>(taskResultStream: Stream.Stream<Delta<G>, E, R>) =>
  <MR extends Schema.Json>({
    exec,
    metadata,
    chart,
  }: Metric<G, MR>): Stream.Stream<Result, E | MetricError, R> =>
    taskResultStream.pipe(
      Stream.mapAccumEffect(
        () => ({ results: {} as BenchResult<G>, prev: null as MR | null }),
        Effect.fn(function* ({ results, prev }, delta) {
          const nextResults = { ...results, [delta[0]]: delta[1] };
          const next = yield* Effect.tryPromise({
            try: () => Promise.resolve(exec(nextResults, delta, prev)),
            catch: MetricError.exec(metadata.id),
          });

          return [
            { results: nextResults, prev: next },
            [
              Result.make({
                metricID: metadata.id,
                value: next,
                chart: chart?.(next) ?? null,
              }),
            ],
          ] as const;
        }),
      ),
    );
