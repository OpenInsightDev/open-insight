import { Effect, Match, Stream, Result } from "effect";
import { Prompt, Tool, Response } from "effect/unstable/ai";
import { castDraft, produce } from "immer";
import { TrajectoryError } from "./error.ts";
import type { Part, Trajectory } from "./trajectory.ts";

export type SessionTurn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Response.PartView<Tools>[];
}>;

export type Session<Tools extends Record<string, Tool.Any>> = Stream.Stream<
  SessionTurn<Tools>,
  TrajectoryError
>;

export const session = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Session<Tools> => {
  const initial = (): SessionTurn<Tools> | undefined => undefined;
  const appendResponse = (
    turn: SessionTurn<Tools>,
    part: Extract<Part<Tools>, { readonly _tag: "Response" }>,
  ): SessionTurn<Tools> =>
    produce(turn, (draft) => {
      draft.response.push(castDraft(part.response));
    });

  return trajectory.pipe(
    Stream.mapAccum<SessionTurn<Tools> | undefined, Part<Tools>, SessionTurn<Tools>>(
      initial,
      (turn, part): readonly [SessionTurn<Tools> | undefined, readonly SessionTurn<Tools>[]] =>
        Match.value(part).pipe(
          Match.tagsExhaustive({
            Prompt: (prompt) =>
              [
                {
                  prompt: Prompt.fromMessages(prompt.messages),
                  response: [] as Response.PartView<Tools>[],
                },
                turn ? [turn] : [],
              ] as const,
            Response: (response) => [turn ? appendResponse(turn, response) : turn, []] as const,
          }),
        ),
      { onHalt: (turn) => (turn ? [turn] : []) },
    ),
  );
};

export const prompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  session(trajectory).pipe(
    Stream.runFold(
      () => Prompt.empty,
      (curr, { prompt, response }) =>
        Prompt.concat(curr, Prompt.concat(prompt, Prompt.fromResponseParts(response))),
    ),
  );

export const responses = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError> =>
  trajectory.pipe(
    Stream.filterMap((part) =>
      Match.value(part).pipe(
        Match.tagsExhaustive({
          Response: ({ response }) => Result.succeed(response),
          Prompt: Result.fail,
        }),
      ),
    ),
  );
