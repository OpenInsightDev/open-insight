import { Array as Arr, Crypto, Data, Effect, Schema, Stream } from "effect";
import { Tool, Toolkit, Response } from "effect/unstable/ai";
import * as Fold from "#/response/fold.ts";
import { TrajectoryError } from "./error.ts";
import {
  Part,
  PartMetadata,
  PromptMessage,
  PromptPart,
  ResponsePart,
  Trajectory,
  type PartEncoded,
  type PromptMessageEncoded,
} from "./trajectory.ts";

export class TrajectoryEncoded extends Data.Class<{
  parts: Stream.Stream<PartEncoded, TrajectoryError>;
}> {}

export const encode = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  trajectory: Trajectory<Tools>,
) {
  const partSchema = Part(trajectory.toolkit);
  const encodingContext = yield* Effect.context<typeof partSchema.EncodingServices>();
  const encodePart = Schema.encodeEffect(partSchema);

  const parts = trajectory.parts.pipe(
    Stream.mapEffect((part) =>
      encodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(encodingContext),
      ),
    ),
  );

  return new TrajectoryEncoded({ parts });
});

export const decode = Effect.fn(function* <Toolkits extends ReadonlyArray<Toolkit.Any>>(
  trajectory: TrajectoryEncoded,
  ...toolkits: Toolkits
) {
  const toolkit = Toolkit.merge(...toolkits);
  const partSchema = Part(toolkit);
  const decodingContext = yield* Effect.context<typeof partSchema.DecodingServices>();
  const decodePart = Schema.decodeEffect(partSchema);

  const parts = trajectory.parts.pipe(
    Stream.mapEffect((part) =>
      decodePart(part).pipe(
        Effect.mapError(TrajectoryError.decode),
        Effect.provideContext(decodingContext),
      ),
    ),
  );

  return new Trajectory<Toolkit.MergedTools<Toolkits>>({ toolkit, parts });
});

export type EncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded[] | Response.AllPartsEncoded,
  E,
  R
>;

export const makeEncoded = Effect.fn(function* <E, R>(stream: EncodedStream<E, R>) {
  const sourceContext = yield* Effect.context<R>();
  const crypto = yield* Crypto.Crypto;
  const toolkit = Toolkit.empty;
  const decodeMessages = Schema.decodeEffect(Schema.Array(PromptMessage));
  const decodeResponse = Schema.decodeEffect(Response.AllPartsView(toolkit));
  const responsePart = ResponsePart(toolkit);

  const makeMetadata = Effect.fn(function* () {
    const uuid = yield* crypto.randomUUIDv7.pipe(Effect.mapError(TrajectoryError.decode));
    return yield* PartMetadata.makeEffect({ uuid }).pipe(Effect.mapError(TrajectoryError.decode));
  });

  const parts = stream.pipe(
    Stream.provideContext(sourceContext),
    Stream.mapError(TrajectoryError.storage),
    Stream.mapAccumEffect<
      Fold.State,
      PromptMessageEncoded[] | Response.AllPartsEncoded,
      Part<{}>,
      TrajectoryError,
      never
    >(Fold.makeState, (state, part) =>
      Effect.gen(function* () {
        if (Arr.isArray(part)) {
          const messages = yield* decodeMessages(part).pipe(
            Effect.mapError(TrajectoryError.decode),
          );
          const metadata = yield* makeMetadata();
          return [Fold.makeState(), [PromptPart.make({ ...metadata, messages })]] as const;
        }

        const response = yield* decodeResponse(part).pipe(Effect.mapError(TrajectoryError.decode));
        const [next, responses] = Fold.foldPart(state, response);
        const output = yield* Effect.forEach(responses, (response) =>
          makeMetadata().pipe(
            Effect.map((metadata) => responsePart.make({ ...metadata, response })),
          ),
        );
        return [next, output] as const;
      }),
    ),
  );

  return yield* encode(new Trajectory({ toolkit, parts }));
});
