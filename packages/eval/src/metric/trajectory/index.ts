import type { Prompt } from "@open-insight/core/internal";
import type { Stream } from "effect";
import type { Tool, Response } from "effect/unstable/ai";
import * as Chart from "#/chart/index.ts";

export type Metric<Tools extends Record<string, Tool.Any>, E, R> = (
  stream: Stream.Stream<Prompt.Prompt | Response.Part<Tools>>,
) => Stream.Stream<Chart.Points, E, R>;
