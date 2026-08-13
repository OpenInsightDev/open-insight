import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, SynchronizedRef } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";
import type { TaskResult } from "../task/index.ts";

export type BenchResult<G = unknown> = Readonly<Record<string, TaskResult<G>>>;

/**
 * Computes a benchmark metric whenever a new task result is available.
 *
 * @param results All benchmark results collected so far, including the current `delta`.
 * @param delta The task result that triggered this computation.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<G = unknown, R extends Schema.Json = Schema.Json> = (
  results: BenchResult<G>,
  delta: TaskResult<G>,
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
  const resultRef = yield* SynchronizedRef.make<BenchResult>({});

  const create = Effect.fn(function* ({ exec, metadata, chart }: Metric) {
    const prevRef = yield* SynchronizedRef.make<Schema.Json | null>(null);

    return (results: BenchResult, result: TaskResult) =>
      prevRef.pipe(
        SynchronizedRef.modifyEffect(
          Effect.fn(function* (prev) {
            const next = yield* Effect.tryPromise({
              try: () => Promise.resolve(exec(results, result, prev)),
              catch: MetricError.exec(metadata.id),
            });

            return [
              Result.make({
                id: metadata.id,
                value: next,
                chart: chart?.(next) ?? null,
              }),
              next,
            ];
          }),
        ),
      );
  });

  const runs = yield* Effect.all(metrics.map(create));

  return (result: TaskResult & Readonly<{ task: string }>) =>
    resultRef.pipe(
      SynchronizedRef.modifyEffect(
        Effect.fn(function* (prev) {
          const next = {
            ...prev,
            [result.task]: result,
          };
          const metricResults = yield* Effect.all(runs.map((run) => run(next, result)));
          return [metricResults, next];
        }),
      ),
    );
});
