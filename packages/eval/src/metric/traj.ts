import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";
import { always, type Context, type When } from "./when.ts";

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (ctx: Context) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  id: string;

  when: When;
  exec: BivariantFn<Parameters<Exec<R>>, ReturnType<Exec<R>>>;

  name: string;
  description: string | null;
  chart: BivariantFn<Parameters<Chart.Chart<R>>, ReturnType<Chart.Chart<R>>> | null;
  metadata: Metadata;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;

  when?: When;
  name?: string;
  description?: string | null;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Options<R>,
) {
  const {
    exec,
    when = always,
    name = "Trajectory Metric",
    description = null,
    chart = null,
  } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)({ ...options, name, description });
  const { id } = metadata;

  return { id, name, exec, when, description, chart, metadata } satisfies Metric<R>;
});
