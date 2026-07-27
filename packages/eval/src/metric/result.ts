import { Schema, Stream } from "effect";
import * as Chart from "#/chart/index.ts";

export const Result = Schema.Record(Schema.String, Schema.Json);
export type Result = Schema.Schema.Type<typeof Result>;

export type StreamResult = Readonly<{
  id: string;
  result: Result;
  chart: Chart.Return | null;
}>;
export type ResultStream<E, R> = Stream.Stream<StreamResult, E, R>;
