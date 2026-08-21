import type { Stream } from "effect";
import * as Chart from "#/chart/index.ts";
import { Prompt, Sandbox, Response } from "@open-insight/core/internal";

export type Metric<In, E = never, R = never> = <E2, R2>(
  stream: Stream.Stream<In, E2, R2>,
) => Stream.Stream<Chart.Points, E | E2, R | R2>;

export type SchedMetric = Metric<void, never, Sandbox.Current>;
export type TrajMetric = Metric<Prompt.Prompt | Response.AnyAggPart>;
