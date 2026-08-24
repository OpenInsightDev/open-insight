import { DateTime, Schedule, Stream } from "effect";
import * as Chart from "#/chart/index.ts";
import { Sandbox } from "@open-insight/core/internal";
import type { MetricError } from "../error.ts";
import type { Metadata } from "../schema.ts";

type Context = Sandbox.ReadonlySandbox;

/** Converts a schedule to one that emits its step time on each recurrence. */
export const toDateTime = <Output, Input, Error, Env>(
  schedule: Schedule.Schedule<Output, Input, Error, Env>,
): Schedule.Schedule<DateTime.DateTime, Input, Error, Env> =>
  schedule.pipe(Schedule.map(({ now }) => DateTime.makeUnsafe(now)));

export type Metric = Readonly<{
  metadata: Metadata;
  transform: (stream: Stream.Stream<DateTime.DateTime>) => Stream.Stream<Chart.Points, MetricError>;
}>;
