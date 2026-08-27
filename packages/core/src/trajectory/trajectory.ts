import { Data, Effect, Match, Schema, Stream } from "effect";
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

export const PromptPart = Schema.TaggedStruct("Prompt", {
  messages: Schema.Array(PromptMessage),
});
export type PromptPart = Schema.Schema.Type<typeof PromptPart>;
export type PromptPartEncoded = typeof PromptPart.Encoded;

export const ResponsePart = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.TaggedStruct("Response", {
    response: Response.PartView(toolkit),
  });
export type ResponsePart<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof ResponsePart<Toolkit.Toolkit<Tools>>>
>;
export type ResponsePartEncoded = ReturnType<
  typeof ResponsePart<Toolkit.Toolkit<Record<string, Tool.Any>>>
>["Encoded"];

export const Part = <T extends Toolkit.Any>(toolkit: T) =>
  Schema.Union([PromptPart, ResponsePart(toolkit)]);
export type Part<Tools extends Record<string, Tool.Any>> = Schema.Schema.Type<
  ReturnType<typeof Part<Toolkit.Toolkit<Tools>>>
>;
export type PartEncoded = ReturnType<
  typeof Part<Toolkit.Toolkit<Record<string, Tool.Any>>>
>["Encoded"];

/**
 * A trajectory represents a sequence of turns in a conversation, where each turn consists of a prompt and the corresponding response.
 */
export class Trajectory<Tools extends Record<string, Tool.Any>> extends Data.Class<{
  toolkit: Toolkit.Toolkit<Tools>;
  parts: Stream.Stream<Part<Tools>, TrajectoryError>;
}> {}

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
  const partSchema = Part(toolkit);
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
    Stream.mapAccum(makeFoldState, (state, decodedPart) =>
      Match.value(decodedPart).pipe(
        Match.tag(
          "Prompt",
          ({ value: messages }) =>
            [makeFoldState(), [partSchema.make({ _tag: "Prompt", messages })]] as const,
        ),
        Match.tag("Response", ({ value }) => {
          const [next, responses] = foldPart(state, value);
          return [
            next,
            responses.map((response) => partSchema.make({ _tag: "Response", response })),
          ] as const;
        }),
        Match.exhaustive,
      ),
    ),
  );

  return new Trajectory<Toolkit.MergedTools<Toolkits>>({
    toolkit,
    parts,
  });
});
