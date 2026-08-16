import * as Chart from "#/chart/index.ts";
import * as Task from "#/task/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";
import type { TaskResult } from "../task/index.ts";

export type BenchResult<G = unknown> = Readonly<Record<string, TaskResult<G>>>;
export type Delta<G = unknown> = Readonly<Record<Task.ID, TaskResult<G>>>;

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
  <G = unknown, E = never, R = never>(stream: Stream.Stream<BenchResult<G>, E, R>) =>
  <MR extends Schema.Json>({
    exec,
    metadata,
    chart,
  }: Metric<G, MR>): Stream.Stream<Result, E | MetricError, R> =>
    stream.pipe(
      Stream.mapAccumEffect(
        () => ({ results: {} as BenchResult<G>, prev: null as MR | null }),
        (state, nextResults) => {
          const changes = Object.entries(nextResults).filter(
            ([task, result]) => state.results[task] !== result,
          );

          if (changes.length === 0) {
            return Effect.succeed([state, [] as ReadonlyArray<Result>] as const);
          }

          return Effect.gen(function* () {
            let current = state;
            const outputs: Array<Result> = [];

            for (const [task, delta] of changes) {
              const results = { ...current.results, [task]: delta };
              const next = yield* Effect.tryPromise({
                try: () => Promise.resolve(exec(results, delta, current.prev)),
                catch: MetricError.exec(metadata.id),
              });

              outputs.push(
                Result.make({
                  id: metadata.id,
                  value: next,
                  chart: chart?.(next) ?? null,
                }),
              );
              current = { results, prev: next };
            }

            return [current, outputs] as const;
          });
        },
      ),
    );
