import { Prompt } from "@open-insight/core/internal";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Chart from "#/chart/index.ts";
import { MetricError } from "../error.ts";

export type Context = Readonly<{
  prompt: Prompt.Prompt;
  trajectory: Prompt.Trajectory;
}>;

export type Delta = Prompt.ResponsePart;

type Nullable<T> = T | null;
export type RespExec<R extends Schema.Json = Schema.Json> = (
  response: ReadonlyArray<Prompt.ResponsePart>,
  delta: Prompt.ResponsePart,
  prev: R | null,
) => Nullable<R> | Promise<Nullable<R>>;

export type Exec<R extends Schema.Json = Schema.Json> = (context: Context) => RespExec<R>;

export type Metric<R extends Schema.Json = Schema.Json> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
}>;

export type Options<R extends Schema.Json = Schema.Json> = Readonly<{
  exec: Exec<R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.Json = Schema.Json>(options: Options<R>) {
  const { exec, chart = null } = options;

  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return { metadata, exec, chart } satisfies Metric<R>;
});

type StreamOptions<E, R> = Context &
  Readonly<{
    stream: Stream.Stream<Prompt.ResponsePart, E, R>;
  }>;

export const makeStream =
  <E, R>({ trajectory, prompt, stream }: StreamOptions<E, R>) =>
  ({ exec, metadata, chart }: Metric): Stream.Stream<Result, E | MetricError, R> => {
    const respExec = exec({ trajectory, prompt });

    return stream.pipe(
      Stream.mapAccumEffect(
        () => ({ response: [] as Prompt.ResponsePart[], prev: null as Schema.Json | null }),
        ({ response, prev }, delta) =>
          Effect.tryPromise({
            try: () => Promise.resolve(respExec(response, delta, prev)),
            catch: MetricError.exec(metadata.id),
          }).pipe(
            Effect.map((next) => [
              { response: [...response, delta], prev: next },
              [
                Result.make({
                  id: metadata.id,
                  value: next,
                  chart: chart?.(next) ?? null,
                }),
              ],
            ]),
          ),
      ),
    );
  };
