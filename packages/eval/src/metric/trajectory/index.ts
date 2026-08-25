import { Prompt, Response } from "@open-insight/core/internal";
import { Effect, Match, Schema, Stream } from "effect";
import { type Tool, Toolkit } from "effect/unstable/ai";
import * as Chart from "#/chart/index.ts";
import { MetricError } from "../error.ts";
import { Metadata, type MetadataEncoded } from "../schema.ts";

export type Metric = Readonly<{
  metadata: Metadata;
  transform: <E, R>(
    stream: Stream.Stream<Prompt.Prompt | Response.PartView<any>, E, R>,
  ) => Stream.Stream<Chart.Points, E | MetricError, R>;
}>;

export type Mapper<Tools extends Record<string, Tool.Any>, E, R> = (
  stream: Stream.Stream<Prompt.Prompt | Response.PartView<Tools>, E, R>,
) => Stream.Stream<Chart.Points, E | unknown, R>;

export type Options = MetadataEncoded & Readonly<{}>;
export const make =
  <const Toolkits extends ReadonlyArray<Toolkit.Any>>(...toolkits: Toolkits) =>
  (mapper: Mapper<Toolkit.MergedTools<Toolkits>>, options: Options = {}): Metric => {
    const metadata = Schema.decodeSync(Metadata)(options);
    const decode = Response.decodePartView(Toolkit.merge(...toolkits));

    return {
      metadata,
      transform: (stream) => {
        const decoded = stream.pipe(
          Stream.mapEffect((value) =>
            Match.value(value).pipe(
              Match.when(Prompt.isPrompt, (prompt) => Effect.succeed(prompt)),
              Match.orElse((part) => decode(part)),
            ),
          ),
        );

        return decoded.pipe(Stream.mapError((e) => new MetricError({}))).pipe(mapper);
      },
    };
  };
