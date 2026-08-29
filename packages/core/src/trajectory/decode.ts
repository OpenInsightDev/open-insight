import { Effect, Match, Schema, Stream } from "effect";
import { Response, Toolkit } from "effect/unstable/ai";
import { foldPart, makeFoldState } from "../response/fold.ts";
import { TrajectoryError } from "./error.ts";
import { Part, PromptMessage, Trajectory, type PromptMessageEncoded } from "./trajectory.ts";

export type EncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded[] | Response.AllPartsEncoded,
  E,
  R
>;

const isPromptEncoded = (
  value: PromptMessageEncoded[] | Response.AllPartsEncoded,
): value is PromptMessageEncoded[] => Array.isArray(value);

export const decode = Effect.fn(function* <E, R, Toolkits extends ReadonlyArray<Toolkit.Any>>(
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

  return new Trajectory<Toolkit.MergedTools<Toolkits>>({ toolkit, parts });
});
