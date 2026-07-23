import * as Grade from "#/grade/index.ts";
import * as Task from "#/task/index.ts";
import * as Chart from "#/chart/index.ts";
import type { Prompt } from "@open-insight/core/internal";
import { Effect, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";

type Result<G extends Grade.Result = Grade.Result> = Readonly<{
  grade: G;
  trajectory: Prompt.Trajectory;
}>;

type Delta<G extends Grade.Result = Grade.Result> = Result<G> & Readonly<{ task: Task.ID }>;

type Results<G extends Grade.Result = Grade.Result> = Readonly<Record<Task.ID, Array<Result<G>>>>;

export type Exec<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = (results: Results<G>, delta: Delta<G>, prev: R | null) => Promise<R>;

export type Metric<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  id: string;
  exec: Exec<G, R>;
  name: string;
  description: string | null;
  chart: Chart.Chart<R> | null;
  metadata: Metadata;
}>;

export type Options<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  exec: Exec<G, R>;
  name?: string;
  description?: string | null;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
>(options: Options<G, R>) {
  const { exec, name = "Benchmark Metric", description = null, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)({ ...options, name, description });
  const { id } = metadata;

  return { id, exec, name, description, chart, metadata } satisfies Metric<G, R>;
});
