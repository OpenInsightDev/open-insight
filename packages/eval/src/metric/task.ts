import * as Chart from "#/chart/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

type Results = ReadonlyArray<TrailResult>;

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (
  results: Results,
  delta: TrailResult,
  prev: R | null,
) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: BivariantFn<Parameters<Exec<R>>, ReturnType<Exec<R>>>;
  chart: BivariantFn<Parameters<Chart.Chart<R>>, ReturnType<Chart.Chart<R>>> | null;
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
