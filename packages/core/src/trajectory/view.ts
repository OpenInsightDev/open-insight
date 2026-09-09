import { Effect, Match, Stream, Result } from "effect";
import { Prompt, Tool, Response } from "effect/unstable/ai";
import { castDraft, produce } from "immer";
import { TrajectoryError } from "./error.ts";
import type { Part, Trajectory } from "./trajectory.ts";

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: Prompt.Prompt;
  response: Response.PartView<Tools>[];
}>;

export const turns = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Turn<Tools>, TrajectoryError> =>
  trajectory.pipe(
    Stream.mapAccum<Turn<Tools> | undefined, Part<Tools>, Turn<Tools>>(
      () => undefined,
      (turn, part) => {
        if (part._tag === "Prompt") {
          const next: Turn<Tools> = {
            prompt: Prompt.fromMessages(part.messages),
            response: [],
          };
          return [next, turn === undefined ? [] : [turn]] as const;
        }
        if (turn === undefined) {
          return [turn, []] as const;
        }
        return [
          produce(turn, (draft) => {
            draft.response.push(castDraft(part.response));
          }),
          [],
        ] as const;
      },
      { onHalt: (turn) => (turn === undefined ? [] : [turn]) },
    ),
  );

export const prompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  turns(trajectory).pipe(
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
