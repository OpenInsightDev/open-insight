import { Data } from "effect";
import * as Metric from "./metric.ts";
import type { IndexByKey } from "#/utils/type.ts";

export class MetricRegistry<Metrics extends Record<string, Metric.Any>> extends Data.Class<{
  metrics: Metrics;
}> {}

type Options = Readonly<{}>;

export const make = <Metrics extends ReadonlyArray<Metric.Any>>(
  options: Options,
  ...metrics: Metrics
): MetricRegistry<IndexByKey<Metrics, "id">> => {
  return new MetricRegistry({
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
  });
};

type TrajMetrics<Metrics extends Record<string, Metric.Any>> = ReadonlyArray<
  Extract<Metrics[keyof Metrics], { readonly _tag: "Traj" }>
>;

export const trajMetrics = <Metrics extends Record<string, Metric.Any>>(
  registry: MetricRegistry<Metrics>,
): TrajMetrics<Metrics> => {
  return Object.values(registry.metrics).filter(
    (metric): metric is Extract<Metrics[keyof Metrics], { readonly _tag: "Traj" }> =>
      metric._tag === "Traj",
  );
};

type SchedMetrics<Metrics extends Record<string, Metric.Any>> = ReadonlyArray<
  Extract<Metrics[keyof Metrics], { readonly _tag: "Sched" }>
>;

export const schedMetrics = <Metrics extends Record<string, Metric.Any>>(
  registry: MetricRegistry<Metrics>,
): SchedMetrics<Metrics> => {
  return Object.values(registry.metrics).filter(
    (metric): metric is Extract<Metrics[keyof Metrics], { readonly _tag: "Sched" }> =>
      metric._tag === "Sched",
  );
};
