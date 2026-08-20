import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Array, Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";
import type { TrailResult as EventTrailResult } from "#/event/result.ts";
import type * as Map from "./map.ts";
import type * as Accum from "./accum.ts";
import type * as Collect from "./collect.ts";

export type { Map, Accum, Collect };

export type TrailResult<G = unknown> = EventTrailResult<G>;
export type TrailResults<G = unknown> = ReadonlyArray<TrailResult<G>>;

// ─── Variant ─────────────────────────────────────────────────────────────

interface MapVariant<G, R extends Schema.Json> {
  readonly _tag: "Map";
  readonly exec: Map.Exec<G, R>;
}

interface AccumVariant<G, R extends Schema.Json, S = unknown> {
  readonly _tag: "Accum";
  readonly exec: Accum.Exec<G, R, S>;
  readonly initialState: S;
}

interface CollectVariant<G, R extends Schema.Json> {
  readonly _tag: "Collect";
  readonly exec: Collect.Exec<G, R>;
}

export type Variant<G = unknown, R extends Schema.Json = Schema.Json> =
  | MapVariant<G, R>
  | AccumVariant<G, R, unknown>
  | CollectVariant<G, R>;

function makeMapVariant<G, R extends Schema.Json>(exec: Map.Exec<G, R>): MapVariant<G, R> {
  return { _tag: "Map", exec };
}

function makeAccumVariant<G, R extends Schema.Json, S>(
  exec: Accum.Exec<G, R, S>,
  initialState: S,
): AccumVariant<G, R, S> {
  return { _tag: "Accum", exec, initialState };
}

function makeCollectVariant<G, R extends Schema.Json>(
  exec: Collect.Exec<G, R>,
): CollectVariant<G, R> {
  return { _tag: "Collect", exec };
}

// ─── Metric ──────────────────────────────────────────────────────────────

export type Metric<G = unknown, R extends Schema.Json = Schema.Json> = Readonly<{
  variant: Variant<G, R>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options = Readonly<{
  chart?: Chart.Chart<Schema.Json> | null;
}> &
  MetadataEncoded;

// ─── Constructors ────────────────────────────────────────────────────────

export const makeMap = Effect.fn(function* <G = unknown, R extends Schema.Json = Schema.Json>(
  options: Map.Options<G, R> & Options,
) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return { variant: makeMapVariant<G, R>(exec), chart, metadata } satisfies Metric<G, R>;
});

export const makeAccum = Effect.fn(function* <
  G = unknown,
  R extends Schema.Json = Schema.Json,
  S = unknown,
>(options: Accum.Options<G, R, S> & Options) {
  const { exec, initialState, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return {
    variant: makeAccumVariant<G, R, S>(exec, initialState) as Variant<G, R>,
    chart,
    metadata,
  } satisfies Metric<G, R>;
});

export const makeCollect = Effect.fn(function* <G = unknown, R extends Schema.Json = Schema.Json>(
  options: Collect.Options<G, R> & Options,
) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );
  return { variant: makeCollectVariant<G, R>(exec), chart, metadata } satisfies Metric<G, R>;
});

// ─── makeStream ──────────────────────────────────────────────────────────

export const makeStream =
  <G = unknown, E = never, R = never>(trailResultStream: Stream.Stream<TrailResult<G>, E, R>) =>
  <M extends Schema.Json>({
    variant,
    metadata,
    chart,
  }: Metric<G, M>): Stream.Stream<Result, E | MetricError, R> => {
    const id = metadata.id;

    switch (variant._tag) {
      case "Map": {
        const { exec } = variant as MapVariant<unknown, M>;
        return trailResultStream.pipe(
          Stream.mapEffect((delta) =>
            Effect.tryPromise({
              try: () => Promise.resolve(exec(delta)),
              catch: MetricError.exec(id),
            }).pipe(
              Effect.map((value) =>
                Result.make({
                  metricID: id,
                  value,
                  chart: chart?.(value as M) ?? null,
                }),
              ),
            ),
          ),
        ) as Stream.Stream<Result, E | MetricError, R>;
      }

      case "Accum": {
        const { exec, initialState } = variant as AccumVariant<unknown, M, unknown>;
        return Stream.mapAccumEffect(
          trailResultStream,
          () => initialState as unknown,
          (state: unknown, delta: TrailResult<G>) =>
            Effect.tryPromise({
              try: () => Promise.resolve(exec(delta, state)),
              catch: MetricError.exec(id),
            }).pipe(
              Effect.map(([value, nextState]): [unknown, Result[]] => [
                nextState,
                [
                  Result.make({
                    metricID: id,
                    value,
                    chart: chart?.(value as M) ?? null,
                  }),
                ],
              ]),
            ),
        ) as unknown as Stream.Stream<Result, E | MetricError, R>;
      }

      case "Collect": {
        const { exec } = variant as CollectVariant<unknown, M>;
        return Stream.fromEffect(
          Stream.runCollect(trailResultStream).pipe(
            Effect.map(Array.fromIterable),
            Effect.flatMap((results) =>
              Effect.tryPromise({
                try: () => Promise.resolve(exec(results)),
                catch: MetricError.exec(id),
              }),
            ),
            Effect.map((value) =>
              Result.make({
                metricID: id,
                value,
                chart: chart?.(value as M) ?? null,
              }),
            ),
          ),
        ) as Stream.Stream<Result, E | MetricError, R>;
      }
    }
  };
