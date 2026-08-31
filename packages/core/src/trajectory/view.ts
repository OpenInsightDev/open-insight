import { Effect, Stream } from "effect";
import { Prompt, Tool, Response } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import type { Part, PromptMessage, PromptPart, ResponsePart, Trajectory } from "./trajectory.ts";

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: PromptMessage[];
  response: Response.PartView<Tools>[];
}>;

export const turns = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Turn<Tools>, TrajectoryError> =>
  trajectory.parts.pipe(
    Stream.mapAccum<Turn<Tools> | undefined, Part<Tools>, Turn<Tools>>(
      () => undefined,
      (turn, part) => {
        if (part._tag === "Prompt") {
          const next: Turn<Tools> = {
            prompt: Array.from(part.messages),
            response: [],
          };
          return [next, turn === undefined ? [] : [turn]] as const;
        }
        if (turn === undefined) {
          return [turn, []] as const;
        }
        return [{ ...turn, response: [...turn.response, part.response] }, []] as const;
      },
      { onHalt: (turn) => (turn === undefined ? [] : [turn]) },
    ),
  );

export const prompts = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<PromptMessage[], TrajectoryError> =>
  trajectory.parts.pipe(
    Stream.filter((part): part is PromptPart => part._tag === "Prompt"),
    Stream.map((prompt) => Array.from(prompt.messages)),
  );

export const responses = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError> =>
  trajectory.parts.pipe(
    Stream.filter((part): part is ResponsePart<Tools> => part._tag === "Response"),
    Stream.map((response) => response.response),
  );

export const prompt = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Effect.Effect<Prompt.Prompt, TrajectoryError> =>
  turns(trajectory).pipe(
    Stream.map((turn) => Prompt.fromMessages(turn.prompt)),
    Stream.runCollect,
    Effect.map((prompts) =>
      Array.from(prompts).reduce((acc, prompt) => Prompt.concat(acc, prompt), Prompt.empty),
    ),
  );
