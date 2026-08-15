import { Match, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import type { AnyStreamPart, ResponsePart } from "./schema.ts";

type State = Readonly<{
  text: Map<string, string>;
  reasoning: Map<string, string>;
}>;

const initialState = (): State => ({
  text: new Map(),
  reasoning: new Map(),
});

const noParts = (state: State): readonly [State, ReadonlyArray<ResponsePart>] => [state, []];

const accumulate = (
  state: State,
  part: Response.StreamPartEncoded | AnyStreamPart,
): readonly [State, ReadonlyArray<ResponsePart>] =>
  Match.value(part).pipe(
    Match.withReturnType<readonly [State, ReadonlyArray<ResponsePart>]>(),
    Match.discriminator("type")("text-start", (part) => {
      state.text.set(part.id, "");
      return noParts(state);
    }),
    Match.discriminator("type")("text-delta", (part) => {
      const text = state.text.get(part.id);
      if (text !== undefined) {
        state.text.set(part.id, text + part.delta);
      }
      return noParts(state);
    }),
    Match.discriminator("type")("text-end", (part) => {
      const text = state.text.get(part.id);
      if (text === undefined) {
        return noParts(state);
      }
      state.text.delete(part.id);
      return [state, [Prompt.textPart({ text })]];
    }),
    Match.discriminator("type")("reasoning-start", (part) => {
      state.reasoning.set(part.id, "");
      return noParts(state);
    }),
    Match.discriminator("type")("reasoning-delta", (part) => {
      const text = state.reasoning.get(part.id);
      if (text !== undefined) {
        state.reasoning.set(part.id, text + part.delta);
      }
      return noParts(state);
    }),
    Match.discriminator("type")("reasoning-end", (part) => {
      const text = state.reasoning.get(part.id);
      if (text === undefined) {
        return noParts(state);
      }
      state.reasoning.delete(part.id);
      return [state, [Prompt.reasoningPart({ text })]];
    }),
    Match.discriminator("type")("tool-call", (part) => [
      state,
      [
        Prompt.toolCallPart({
          id: part.id,
          name: part.name,
          params: part.params,
          providerExecuted: part.providerExecuted ?? false,
        }),
      ],
    ]),
    Match.discriminator("type")("tool-result", (part) =>
      (part.preliminary ?? false)
        ? noParts(state)
        : [
            state,
            [
              Prompt.toolResultPart({
                id: part.id,
                name: part.name,
                isFailure: part.isFailure,
                result: part.result,
                providerExecuted: part.providerExecuted ?? false,
              }),
            ],
          ],
    ),
    Match.discriminator("type")("tool-approval-request", (part) => [
      state,
      [
        Prompt.toolApprovalRequestPart({
          approvalId: part.approvalId,
          toolCallId: part.toolCallId,
        }),
      ],
    ]),
    Match.orElse(() => noParts(state)),
  );

/**
 * Converts a stream of encoded response stream parts into prompt parts.
 */
export const fromStreamPartEncodedStream = <E, R>(
  stream: Stream.Stream<Response.StreamPartEncoded, E, R>,
): Stream.Stream<ResponsePart, E, R> => stream.pipe(Stream.mapAccum(initialState, accumulate));

/**
 * Converts a stream of decoded response stream parts into prompt parts.
 *
 * Unlike {@link fromStreamPartEncodedStream}, this preserves decoded tool
 * parameters and results without serializing them again.
 */
export const fromStreamPartStream = <E, R>(
  stream: Stream.Stream<AnyStreamPart, E, R>,
): Stream.Stream<ResponsePart, E, R> => stream.pipe(Stream.mapAccum(initialState, accumulate));
