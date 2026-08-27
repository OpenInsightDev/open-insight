import { Effect, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";

export type PromptMessage = Exclude<Prompt.Message, Prompt.AssistantMessage>;
export type PromptMessageEncoded = Exclude<Prompt.MessageEncoded, Prompt.AssistantMessageEncoded>;

export type StreamTurnEncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded | Response.AllPartsEncoded,
  E,
  R
>;

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: PromptMessage[];
  response: Stream.Stream<Response.PartView<Tools>, TrajectoryError>;
}>;

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  turns: () => Stream.Stream<Turn<Tools>, TrajectoryError>;
}>;

export const make = Effect.fn(function* <E, R, Toolkits extends ReadonlyArray<Toolkit.Any>>(
  stream: StreamTurnEncodedStream<E, R>,
  ...toolkits: Toolkits
) {
  const merged = Toolkit.merge(...toolkits);
});
