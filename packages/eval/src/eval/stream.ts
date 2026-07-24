import { Stream } from "effect";
import { Prompt, Response, type Tool } from "effect/unstable/ai";

type State = Readonly<{
  text: Map<string, string>;
  reasoning: Map<string, string>;
}>;

const initialState = (): State => ({
  text: new Map(),
  reasoning: new Map(),
});

const noParts = (state: State): readonly [State, ReadonlyArray<Prompt.Part>] => [state, []];

/** Converts response stream lifecycle parts into completed prompt parts. */
export const transformPrompt = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
): Stream.Stream<Prompt.Part, E, R> =>
  stream.pipe(
    Stream.mapAccum(initialState, (state, part) => {
      switch (part.type) {
        case "text-start": {
          state.text.set(part.id, "");
          return noParts(state);
        }
        case "text-delta": {
          const text = state.text.get(part.id);
          if (text !== undefined) {
            state.text.set(part.id, text + part.delta);
          }
          return noParts(state);
        }
        case "text-end": {
          const text = state.text.get(part.id);
          if (text === undefined) {
            return noParts(state);
          }
          state.text.delete(part.id);
          return [state, [Prompt.textPart({ text })]];
        }
        case "reasoning-start": {
          state.reasoning.set(part.id, "");
          return noParts(state);
        }
        case "reasoning-delta": {
          const text = state.reasoning.get(part.id);
          if (text !== undefined) {
            state.reasoning.set(part.id, text + part.delta);
          }
          return noParts(state);
        }
        case "reasoning-end": {
          const text = state.reasoning.get(part.id);
          if (text === undefined) {
            return noParts(state);
          }
          state.reasoning.delete(part.id);
          return [state, [Prompt.reasoningPart({ text })]];
        }
        case "tool-call":
          return [
            state,
            [
              Prompt.toolCallPart({
                id: part.id,
                name: part.name,
                params: part.params,
                providerExecuted: part.providerExecuted,
              }),
            ],
          ];
        case "tool-result":
          return part.preliminary
            ? noParts(state)
            : [
                state,
                [
                  Prompt.toolResultPart({
                    id: part.id,
                    name: part.name,
                    isFailure: part.isFailure,
                    result: part.encodedResult,
                  }),
                ],
              ];
        case "tool-approval-request":
          return [
            state,
            [
              Prompt.toolApprovalRequestPart({
                approvalId: part.approvalId,
                toolCallId: part.toolCallId,
              }),
            ],
          ];
        default:
          return noParts(state);
      }
    }),
  );
