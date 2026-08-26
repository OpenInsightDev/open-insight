import { Effect, Schema, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";

type PromptMessage = Exclude<Prompt.Message, Prompt.AssistantMessage>;
type PromptMessageEncoded = Exclude<Prompt.MessageEncoded, Prompt.AssistantMessageEncoded>;

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: PromptMessage[];
  response: Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError>;
}>;

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  turns: () => Stream.Stream<Turn<Tools>, TrajectoryError>;
}>;

export type TurnEncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded | Response.AllPartsEncoded,
  E,
  R
>;

export const prompts = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<PromptMessage[], TrajectoryError> =>
  trajectory.turns().pipe(Stream.map((turn) => turn.prompt));

export const responses = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError> =>
  trajectory.turns().pipe(Stream.flatMap((turn) => turn.response));

export type ToolTurns<Tools extends Record<string, Tool.Any>> = {
  [Name in keyof Tools]: Name extends string
    ? Readonly<{
        call: Extract<Response.ToolCallPartsView<Tools>, { name: Name }>;
        result: Extract<Response.ToolResultPartsView<Tools>, { name: Name }>;
      }>
    : never;
}[keyof Tools];

export const toolTurns = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<ToolTurns<Tools>, TrajectoryError> => {
  const toolNames = new Set(Object.keys(trajectory.toolkit.tools));

  return responses(trajectory).pipe(
    Stream.mapAccum<
      ReadonlyMap<string, Response.ToolCallParts<Tools>>,
      Response.AllPartsView<Tools>,
      ToolTurns<Tools>
    >(
      () => new Map(),
      (pending, response) => {
        if (response.type === "tool-call" && toolNames.has(response.name)) {
          const call = response as Response.ToolCallParts<Tools>;
          const next = new Map(pending);
          next.set(call.id, call);
          return [next, []];
        }

        if (
          response.type !== "tool-result" ||
          response.preliminary === true ||
          !toolNames.has(response.name)
        ) {
          return [pending, []];
        }

        const call = pending.get(response.id);
        if (call === undefined || call.name !== response.name) {
          return [pending, []];
        }

        const next = new Map(pending);
        next.delete(response.id);
        return [next, [{ call, result: response } as ToolTurns<Tools>]];
      },
    ),
  );
};

export const toolCalls = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.ToolCallPartsView<Tools>, TrajectoryError> =>
  toolTurns(trajectory).pipe(Stream.map((turn) => turn.call));

export const messages = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Prompt.Message, TrajectoryError> =>
  trajectory.turns().pipe(
    Stream.flatMap((turn) =>
      Stream.fromIterable(turn.prompt).pipe(
        Stream.concat(
          turn.response.pipe(
            Stream.runCollect,
            Effect.map((parts) => Prompt.fromResponseParts(Array.from(parts)).content),
            Stream.fromEffect,
            Stream.flatMap(Stream.fromIterable),
          ),
        ),
      ),
    ),
  );
