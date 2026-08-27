import { Stream } from "effect";
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
  trajectory.parts().pipe(
    Stream.mapAccum<Turn<Tools> | undefined, Part<Tools>, Turn<Tools>>(
      () => undefined,
      (turn, part) => {
        if (part._tag === "Prompt") {
          const next: Turn<Tools> = {
            prompt: Array.from(part),
            response: [],
          };
          return [next, turn === undefined ? [] : [turn]] as const;
        }
        if (turn === undefined) {
          return [turn, []] as const;
        }
        return [{ ...turn, response: [...turn.response, part] }, []] as const;
      },
      { onHalt: (turn) => (turn === undefined ? [] : [turn]) },
    ),
  );

export const prompts = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<PromptMessage[], TrajectoryError> =>
  trajectory.parts().pipe(
    Stream.filter((part): part is PromptPart => part._tag === "Prompt"),
    Stream.map((prompt) => Array.from(prompt)),
  );

export const responses = <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
): Stream.Stream<Response.AllPartsView<Tools>, TrajectoryError> =>
  trajectory
    .parts()
    .pipe(Stream.filter((part): part is ResponsePart<Tools> => part._tag === "Response"));

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
  turns(trajectory).pipe(
    Stream.flatMap((turn) =>
      Stream.fromIterable([...turn.prompt, ...Prompt.fromResponseParts(turn.response).content]),
    ),
  );
