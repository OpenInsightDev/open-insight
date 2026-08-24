import { Prompt } from "@open-insight/core/internal";
import { Schema, Stream } from "effect";
import { Response, type Tool, Toolkit } from "effect/unstable/ai";
import * as Chart from "#/chart/index.ts";
import type { MetricError } from "../error.ts";
import { Metadata, type MetadataEncoded } from "../schema.ts";

export type Metric = Readonly<{
  metadata: Metadata;
  transform: <E, R>(
    stream: Stream.Stream<Prompt.Prompt | Response.AnyPart, E, R>,
  ) => Stream.Stream<Chart.Points, E | MetricError, R>;
}>;

export type Mapper<Tools extends Record<string, Tool.Any>> = (
  stream: Stream.Stream<Prompt.Prompt | Response.Part<Tools>>,
) => Stream.Stream<Chart.Points, unknown>;

export type Options = MetadataEncoded & Readonly<{}>;
export const make =
  <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
  (mapper: Mapper<Tools>, options: Options = {}) => {
    const metadata = Schema.decodeSync(Metadata)(options);
    throw new Error("Not implemented");
  };
