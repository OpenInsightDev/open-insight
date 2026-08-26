import { Effect, Schema, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError>;
}>;

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  turns: () => Stream.Stream<Turn<Tools>, TrajectoryError>;
}>;

export type TurnEncoded = Readonly<{
  prompt: ReadonlyArray<Prompt.MessageEncoded>;
  response: Stream.Stream<Response.AllPartsEncoded, unknown>;
}>;

export type TurnEncodedStream<E, R> = Stream.Stream<TurnEncoded, E, R>;

/**
 * Creates a trajectory backed by encoded response parts.
 *
 * Toolkits are merged in order, with later toolkits taking precedence when
 * they contain tools with the same name.
 */
export const make = Effect.fn("Trajectory.make")(function* <
  const Toolkits extends ReadonlyArray<Toolkit.Any>,
  E,
  R,
>(
  encodedTurns: TurnEncodedStream<E, R>,
  ...toolkits: Toolkits
): Effect.fn.Return<
  Trajectory<Toolkit.MergedTools<Toolkits>>,
  never,
  | R
  | Tool.ResultDecodingServices<Toolkit.MergedTools<Toolkits>[keyof Toolkit.MergedTools<Toolkits>]>
> {
  const toolkit = Toolkit.merge(...toolkits);
  const responseSchema = Response.AllPartsView(toolkit);
  const decodePrompt = Schema.decodeEffect(Prompt.Prompt);
  const decodeResponse = Schema.decodeEffect(responseSchema);
  const services = yield* Effect.context<R | typeof responseSchema.DecodingServices>();

  return {
    toolkit,
    turns: () =>
      encodedTurns.pipe(
        Stream.mapError(TrajectoryError.storage),
        Stream.mapEffect(({ prompt, response }) =>
          decodePrompt({ content: prompt }).pipe(
            Effect.mapError(TrajectoryError.decode),
            Effect.map((prompt) => ({
              prompt,
              response: response.pipe(
                Stream.mapError(TrajectoryError.storage),
                Stream.mapEffect((encoded) =>
                  decodeResponse(encoded).pipe(Effect.mapError(TrajectoryError.decode)),
                ),
                Stream.provideContext(services),
              ),
            })),
          ),
        ),
        Stream.provideContext(services),
      ),
  };
});

export const prompts = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Prompt.Prompt, TrajectoryError> =>
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
