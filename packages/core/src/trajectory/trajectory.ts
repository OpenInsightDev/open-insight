import { Effect, Schema, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";

export const Trajectory = Prompt.Prompt;

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Response.AllPartsView<Tools>;
}>;

/**
 * Persistent representation of a trajectory.
 *
 * The two streams are consumed point-wise: each prompt is paired with the
 * encoded response at the same position. Implementations should return a
 * fresh stream from each method so that a trajectory can be read more than
 * once.
 */
export type Storage<E = never> = Readonly<{
  prompts: () => Stream.Stream<Prompt.Prompt, E>;
  responses: () => Stream.Stream<Response.AllPartsEncoded, E>;
}>;

export type ToolTurns<Tools extends Record<string, Tool.Any>> = {
  [Name in keyof Tools]: Name extends string
    ? Readonly<{
        call: Extract<Response.ToolCallPartsView<Tools>, { name: Name }>;
        result: Extract<Response.ToolResultPartsView<Tools>, { name: Name }>;
      }>
    : never;
}[keyof Tools];

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  turns: () => Stream.Stream<Turn<Tools>, TrajectoryError>;
}>;

/**
 * Creates a trajectory backed by encoded response parts.
 *
 * Toolkits are merged in order, with later toolkits taking precedence when
 * they contain tools with the same name.
 */
export const make = Effect.fn("Trajectory.make")(function* <
  const Toolkits extends ReadonlyArray<Toolkit.Any>,
  E,
>(
  storage: Storage<E>,
  ...toolkits: Toolkits
): Effect.fn.Return<
  Trajectory<Toolkit.MergedTools<Toolkits>>,
  never,
  Tool.ResultDecodingServices<Toolkit.MergedTools<Toolkits>[keyof Toolkit.MergedTools<Toolkits>]>
> {
  const toolkit = Toolkit.merge(...toolkits);
  const schema = Response.AllPartsView(toolkit);
  const decode = Schema.decodeEffect(schema);
  const decodingServices = yield* Effect.context<typeof schema.DecodingServices>();

  return {
    toolkit,
    turns: () =>
      Stream.zipWith(storage.prompts(), storage.responses(), (prompt, encoded) => ({
        prompt,
        encoded,
      })).pipe(
        Stream.mapError(TrajectoryError.storage),
        Stream.mapEffect(({ prompt, encoded }) =>
          decode(encoded).pipe(
            Effect.mapError(TrajectoryError.decode),
            Effect.map((response) => ({ prompt, response })),
          ),
        ),
        Stream.provideContext(decodingServices),
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
  trajectory.turns().pipe(Stream.map((turn) => turn.response));

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
