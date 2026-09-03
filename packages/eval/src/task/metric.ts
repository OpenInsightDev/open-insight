import * as Task from "./task.ts";
import type { Metric } from "@open-insight/core/internal";
import type { Override } from "@open-insight/core/internal/utils";
import { Option } from "effect";
import { hasProperty } from "effect/Predicate";

const Field: unique symbol = Symbol("Field");
export type Mixin<Metrics extends Record<string, Metric.Any>> = Readonly<{
  [Field]: Metric.Registry<Metrics>;
}>;

export type RegistryOf<T> = T extends Mixin<infer Metrics> ? Metric.Registry<Metrics> : never;
export const registryOf = <T>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as RegistryOf<T>) : null);

export type MetricsOf<T> = Metric.MetricsOf<RegistryOf<T>>;
