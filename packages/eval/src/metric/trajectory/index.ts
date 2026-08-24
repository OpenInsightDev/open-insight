import { Prompt } from "@open-insight/core/internal";
import { Schema, Stream } from "effect";
import { Response, type Tool, Toolkit } from "effect/unstable/ai";
import * as Chart from "#/chart/index.ts";

type InputStream = Stream.Stream<Prompt.Prompt | Response.AnyPart>;

export type Metric<E, R> = (stream: InputStream) => Stream.Stream<Chart.Points, E, R>;
type Mapper<Tools extends Record<string, Tool.Any>, E, R> = (
  stream: Stream.Stream<Prompt.Prompt | Response.Part<Tools>, E, R>,
) => Stream.Stream<Chart.Points, E, R>;

export const make = <Tools extends Record<string, Tool.Any>, E, R>(
  toolkit: Toolkit.Toolkit<Tools>,
  mapper: Mapper<Tools, E, R>,
): Metric<E, R> => {
  return (stream) => {
    throw new Error("Not implemented yet");

    // TODO how to encode any toolkit part into encoded?
    const encodePart = Schema.encodeEffect(Response.Part(Toolkit.empty));
    const decodePart = Schema.decodeEffect(Response.Part(toolkit));
    const toolStream = stream as Stream.Stream<Prompt.Prompt | Response.Part<Tools>, E, R>;

    return toolStream.pipe(mapper);
  };
};
