import { Data, Effect, Scope, Stream } from "effect";
import type { Sandbox } from "@open-insight/sandbox";
import type { Trajectory, Types } from "@open-insight/trajectory";
import * as Metric from "#/Metric.ts";

export class Metrickit<Metrics extends Record<string, Metric.Any>> extends Data.Class<{
  metrics: Metrics;
}> {}

export type MetricsOf<T> = T extends Metrickit<infer Metrics> ? Metrics : never;

export type Any = Metrickit<Record<string, Metric.Any>>;

export const make = <Metrics extends ReadonlyArray<Metric.Any>>(
  ...metrics: Metrics
): Metrickit<Types.IndexByKey<Metrics, "id">> => {
  return new Metrickit({
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
  });
};

export const empty = make();

export const register = <CurrMetrics extends ReadonlyArray<Metric.Any>>(
  ...metrics: CurrMetrics
) => {
  return <PrevMetrics extends Record<string, Metric.Any>>(
    metrickit: Metrickit<PrevMetrics>,
  ): Metrickit<Types.Override<PrevMetrics, Types.IndexByKey<CurrMetrics, "id">>> =>
    new Metrickit({
      metrics: {
        ...metrickit.metrics,
        ...Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
      },
    });
};

export type ResultStream<Metrics extends Record<string, Metric.Any>> = Stream.Stream<
  Metric.ResultOf<Metrics[keyof Metrics]>,
  Metric.MetricError
>;

export const run = Effect.fn("Metrickit.run")(function* <
  Metrics extends Record<string, Metric.Any>,
>(
  metrickit: Metrickit<Metrics>,
  {
    trajectories,
    sandbox,
  }: {
    trajectories: Stream.Stream<Trajectory.Any, Metric.MetricError>;
    sandbox: Sandbox.Sandbox;
  },
): Effect.fn.Return<ResultStream<Metrics>, never, Scope.Scope> {
  const shared = yield* trajectories.pipe(
    Stream.mapEffect(Stream.share({ capacity: "unbounded" })),
    Stream.share({ capacity: "unbounded" }),
  );

  const transformed = Object.values(metrickit.metrics).map((metric) =>
    metric.transform(shared, sandbox),
  );

  return Stream.mergeAll(transformed, { concurrency: "unbounded" });
});
