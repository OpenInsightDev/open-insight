import type { Composable } from "#/chart/schema.ts";
import type { Schema } from "effect";

type MetricDefinition = () => Schema.JsonObject;

export type Metrics = Readonly<Record<string, MetricDefinition>>;

export type ResultOf<M> = M extends () => infer R
  ? R extends Schema.JsonObject
    ? R
    : never
  : never;

export type Input<M extends Metrics> = Readonly<{
  [K in keyof M]: ResultOf<M[K]>;
}>;

export type Chart<M extends Metrics> = (input: Input<M>) => Array<Composable>;

export type Options<M extends Metrics> = Readonly<{
  chart: Chart<M>;
}>;

export type Definition<M extends Metrics = Metrics> = Options<M> &
  Readonly<{
    metrics: M;
  }>;

export const make =
  <const M extends Metrics>(namedMetrics: M) =>
  (options: Options<M>): Definition<M> => ({ metrics: namedMetrics, ...options });
