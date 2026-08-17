import { Prompt } from "@open-insight/core/internal";
import { Effect, Match, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Chart from "#/chart/index.ts";
import { MetricError } from "../error.ts";

type State = Readonly<{
  trajectory: Prompt.Trajectory;
  prompt: Prompt.Prompt;
  response: Prompt.ResponseMessagePart[];
}>;

export type Delta = Prompt.ResponseMessagePart | Prompt.Prompt;

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

type StreamOptions<E, R> = Readonly<{
  stream: Stream.Stream<Prompt.Prompt | Prompt.ResponseMessagePart, E, R>;
}>;

type Accum = State &
  Readonly<{
    prev: Schema.Json | null;
  }>;

const foldPrompt = (state: Accum, prompt: Prompt.Prompt): Accum => {
  const assistant: Prompt.AssistantMessagePart[] = [];
  const tool: Prompt.ToolMessagePart[] = [];

  for (const part of state.response) {
    Match.value(part).pipe(
      Match.whenOr({ type: "tool-result" }, { type: "tool-approval-response" }, (toolPart) =>
        tool.push(toolPart),
      ),
      Match.orElse((part) => assistant.push(part)),
    );
  }

  const messages: Prompt.Message[] = [];
  if (assistant.length > 0) {
    messages.push(Prompt.makeMessage("assistant", { content: assistant }));
  }
  if (tool.length > 0) {
    messages.push(Prompt.makeMessage("tool", { content: tool }));
  }

  const trajectory = state.trajectory.pipe(Prompt.concat(prompt), Prompt.concat(messages));

  return {
    trajectory,
    prompt,
    response: [],
    prev: state.prev,
  };
};

export const makeStream =
  <E, R>({ stream }: StreamOptions<E, R>) =>
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
                        id: metadata.id,
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
