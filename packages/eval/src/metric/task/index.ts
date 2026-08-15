import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema, Stream } from "effect";
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

export const makeStream =
  <G = unknown, E = never, R = never>(stream: Stream.Stream<TrailResult<G>[], E, R>) =>
  <MR extends Schema.Json>({
    exec,
    metadata,
    chart,
  }: Metric<G, MR>): Stream.Stream<Result, E | MetricError, R> =>
    stream.pipe(
      Stream.mapAccumEffect(
        () => ({ results: [] as TaskResult<G>, prev: null as MR | null }),
        (state, delta) => {
          if (delta.length === 0) {
            return Effect.succeed([state, [] as ReadonlyArray<Result>] as const);
          }

          const results = [...state.results, ...delta];
          const trail = delta[delta.length - 1]!;

          return Effect.tryPromise({
            try: () => Promise.resolve(exec(results, trail, state.prev)),
            catch: MetricError.exec(metadata.id),
          }).pipe(
            Effect.map(
              (next) =>
                [
                  { results, prev: next },
                  [
                    Result.make({
                      id: metadata.id,
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
