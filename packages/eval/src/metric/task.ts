import * as Grade from "#/grade/index.ts";
import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Prompt } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

export type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

type Results<G extends Grade.Result = Grade.Result> = ReadonlyArray<Result<G>>;

export type Exec<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = (results: Results<G>, delta: Result<G>, prev: R | null) => Promise<R>;

export type Metric<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  exec: BivariantFn<Parameters<Exec<G, R>>, ReturnType<Exec<G, R>>>;
  chart: BivariantFn<Parameters<Chart.Chart<R>>, ReturnType<Chart.Chart<R>>> | null;
  metadata: Metadata;
}>;

export type Options<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  exec: Exec<G, R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
>(options: Options<G, R>) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options);
  return { exec, chart, metadata } satisfies Metric<G, R>;
});
