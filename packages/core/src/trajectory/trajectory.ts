import { Effect, Match, Schema, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { foldPart, makeFoldState } from "../response/fold.ts";
import { TrajectoryError } from "./error.ts";

export const PromptMessage = Schema.Union([
  Prompt.SystemMessage,
  Prompt.UserMessage,
  Prompt.ToolMessage,
]);
export type PromptMessage = Schema.Schema.Type<typeof PromptMessage>;
export type PromptMessageEncoded = Exclude<Prompt.MessageEncoded, Prompt.AssistantMessageEncoded>;

export type PromptPart = ReadonlyArray<PromptMessage> & Readonly<{ _tag: "Prompt" }>;

export type ResponsePart<Tools extends Record<string, Tool.Any>> = Response.PartView<Tools> &
  Readonly<{ _tag: "Response" }>;

export type Part<Tools extends Record<string, Tool.Any>> = PromptPart | ResponsePart<Tools>;

const promptPart = <Tools extends Record<string, Tool.Any>>(
  messages: ReadonlyArray<PromptMessage>,
): Part<Tools> => Object.assign(Array.from(messages), { _tag: "Prompt" as const });

const responsePart = <Tools extends Record<string, Tool.Any>>(
  part: Response.PartView<Tools>,
): Part<Tools> => Object.assign({ _tag: "Response" as const }, part);

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export type Trajectory<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  parts: Stream.Stream<Part<Tools>, TrajectoryError>;
}>;

export type Turn<Tools extends Record<string, Tool.Any>> = Readonly<{
  prompt: PromptMessage[];
  response: Response.PartView<Tools>[];
}>;

export type EncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded[] | Response.AllPartsEncoded,
  E,
  R
>;

const isPromptEncoded = (
  value: PromptMessageEncoded[] | Response.AllPartsEncoded,
): value is PromptMessageEncoded[] => Array.isArray(value);

export const make = Effect.fn(function* <E, R, Toolkits extends ReadonlyArray<Toolkit.Any>>(
  stream: EncodedStream<E, R>,
  ...toolkits: Toolkits
) {
  const toolkit = Toolkit.merge(...toolkits);
  const prompt = Schema.Array(PromptMessage);
  const response = Response.AllPartsView(toolkit);
  const sourceContext = yield* Effect.context<R>();
  const decodingContext = yield* Effect.context<typeof response.DecodingServices>();
  const decode = Match.type<PromptMessageEncoded[] | Response.AllPartsEncoded>().pipe(
    Match.when(isPromptEncoded, (encoded) =>
      Schema.decodeEffect(prompt)(encoded).pipe(
        Effect.map((value) => ({ _tag: "Prompt", value }) as const),
        Effect.mapError(TrajectoryError.decode),
      ),
    ),
    Match.orElse((encoded) =>
      Schema.decodeEffect(response)(encoded).pipe(
        Effect.map((value) => ({ _tag: "Response", value }) as const),
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  const parts = stream.pipe(
    Stream.provideContext(sourceContext),
    Stream.mapError(TrajectoryError.storage),
    Stream.mapEffect(decode),
    Stream.mapAccum(makeFoldState, (state, part) =>
      Match.value(part).pipe(
        Match.tag("Prompt", ({ value }) => [makeFoldState(), [promptPart(value)]] as const),
        Match.tag("Response", ({ value }) => {
          const [next, responses] = foldPart(state, value);
          return [next, responses.map(responsePart)] as const;
        }),
        Match.exhaustive,
      ),
    ),
  );

  return {
    toolkit,
    parts,
  } satisfies Trajectory<Toolkit.MergedTools<Toolkits>>;
});
