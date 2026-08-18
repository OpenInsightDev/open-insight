import { Prompt, Response } from "@open-insight/core/internal";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Chart from "#/chart/index.ts";
import { MetricError } from "../error.ts";

type State = Readonly<{
  /**
   * Trajectory of the previous prompts and responses.
   * Note that this trajectory does not include the current prompt and response.
   *
   * See {@link Prompt.Trajectory} for the definition.
   */
  trajectory: Prompt.Trajectory;

  /**
   * The prompt of the current turn.
   * See {@link Prompt.Prompt} for the definition.
   */
  prompt: Prompt.Prompt;

  /**
   * The response parts of the current turn.
   * See {@link Response.AnyAggPart} for the definition.
   */
  response: Response.AnyAggPart[];
}>;

/**
 * Stream part for metric to monitoring on session.
 *
 * Consists of:
 * - {@link Prompt.Prompt}: The prompt of a new turn. Use {@link Prompt.isPrompt} to guard.
 * - {@link Response.AnyAggPart}: The response parts of the current turn.
 */
export type Delta = Prompt.Prompt | Response.AnyAggPart;

type Nullable<T> = T | null;
export type Exec<R extends Schema.Json = any> = (
  state: State,
  delta: Delta,
  prev: R | null,
) => Nullable<R> | PromiseLike<Nullable<R>>;

export type Metric<R extends Schema.Json = any> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
}>;

export type Options<R extends Schema.Json = any> = Readonly<{
  exec: Exec<R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

/**
 *
 */
export const make = Effect.fn(function* <R extends Schema.Json = any>(options: Options<R>) {
  const { exec, chart = null } = options;

  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return { metadata, exec, chart } satisfies Metric<R>;
});

type Accum = State &
  Readonly<{
    prev: Schema.Json | null;
  }>;

const foldPrompt = (state: Accum, prompt: Prompt.Prompt) => {
  const responsePrompt = Prompt.fromResponseParts(state.response);
  const trajectory = state.trajectory.pipe(Prompt.concat(prompt), Prompt.concat(responsePrompt));

  return {
    prev: state.prev,
    trajectory,
    prompt,
    response: [],
  } satisfies Accum;
};

export const makeStream =
  <E, R>(stream: Stream.Stream<Prompt.Prompt | Response.AnyAggPart, E, R>) =>
  ({ exec, metadata, chart }: Metric): Stream.Stream<Result, E | MetricError, R> => {
    return stream.pipe(
      Stream.mapAccumEffect(
        (): Accum => ({ trajectory: Prompt.empty, prompt: Prompt.empty, response: [], prev: null }),
        (state, delta) => {
          const nextState = Prompt.isPrompt(delta)
            ? foldPrompt(state, delta)
            : { ...state, response: [...state.response, delta] };

          return Effect.tryPromise({
            try: () => Promise.resolve(exec(nextState, delta, state.prev)),
            catch: MetricError.exec(metadata.id),
          }).pipe(
            Effect.map((next) =>
              next === null
                ? [{ ...nextState, prev: state.prev }, []] // skip: keep the previous result
                : [
                    { ...nextState, prev: next },
                    [
                      Result.make({
                        metricID: metadata.id,
                        value: next,
                        chart: chart?.(next) ?? null,
                      }),
                    ],
                  ],
            ),
          );
        },
      ),
    );
  };
