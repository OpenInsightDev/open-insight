import * as Task from "#/task/index.ts";
import * as Chart from "#/chart/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import { Effect, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

export type Delta = TrailResult & Readonly<{ task: Task.ID }>;

export type Results = Readonly<Record<Task.ID, Array<TrailResult>>>;

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (
  results: Results,
  delta: Delta,
  prev: R | null,
) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;
  chart: Chart.Chart<R> | null;
  metadata: Metadata;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Options<R>,
) {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options);
  return { exec, chart, metadata } satisfies Metric<R>;
});
