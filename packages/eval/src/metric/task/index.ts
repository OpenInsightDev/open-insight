import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, SynchronizedRef } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
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
  const taskResultRef = yield* SynchronizedRef.make<Array<TrailResult>>([]);

  const create = Effect.fn(function* ({ exec, metadata, chart }: Metric) {
    const prevRef = yield* SynchronizedRef.make<Schema.Json | null>(null);

    return (results: Array<TrailResult>, result: TrailResult) =>
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

  return (trailResult: TrailResult) =>
    taskResultRef.pipe(
      SynchronizedRef.modifyEffect(
        Effect.fn(function* (prev) {
          const next = [...prev, trailResult];
          const metricResults = yield* Effect.all(runs.map((run) => run(next, trailResult)));
          return [metricResults, next];
        }),
      ),
    );
});
