import * as Task from "./task.ts";
import type * as Metric from "#/metric/metric.ts";
import type { Override } from "#/utils/type.ts";
import { Option } from "effect";
import { hasProperty } from "effect/Predicate";

const Field: unique symbol = Symbol("Field");
export type Mixin<Metrics extends ReadonlyArray<Metric.Any>> = Readonly<{
  [Field]: Metrics;
}>;

export type MetricsOf<T> = T extends Mixin<infer M> ? M : never;
export function metricsOf<T>(value: T): Option.Option<MetricsOf<T>>;
export function metricsOf(value: unknown) {
  return Option.fromNullOr(
    hasProperty(value, Field) && Array.isArray(value[Field]) ? value[Field] : null,
  );
}

type Append<T, M extends Metric.Any> = T extends Mixin<infer Metrics> ? [...Metrics, M] : [M];

export function metric<M extends Metric.Any>(
  metric: M,
): <T extends Task.Any>(task: T) => Override<T, Mixin<Append<T, M>>>;
export function metric(metric: Metric.Any) {
  return (task: Task.Any) => {
    if (hasProperty(task, Field) && Array.isArray(task[Field])) {
      task[Field].push(metric);
      return task;
    }

    return Object.assign(task, { [Field]: [metric] });
  };
}
