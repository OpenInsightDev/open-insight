import { Crypto, Effect, Stream } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import * as Fold from "#/response/fold.ts";
import { TrajectoryError } from "./error.ts";
import {
  PartMetadata,
  PromptMessage,
  PromptPart,
  ResponsePart,
  type Trajectory,
} from "./trajectory.ts";

export type SessionTurn<Tools extends Record<string, Tool.Any>, E> = Readonly<{
  prompt: Prompt.Prompt;
  response: Stream.Stream<Response.StreamPartView<Tools>, E>;
}>;

export type Session<Tools extends Record<string, Tool.Any>, E = unknown, R = never> = Stream.Stream<
  SessionTurn<Tools, E>,
  E,
  R
>;

export const fromSession = Effect.fn(function* <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Session<Tools, E, R>,
  toolkit: Toolkit.Toolkit<Tools>,
) {
  const sourceContext = yield* Effect.context<R>();
  const crypto = yield* Crypto.Crypto;
  const responsePart = ResponsePart(toolkit);

  const metadata = crypto.randomUUIDv7.pipe(
    Effect.map((uuid) => PartMetadata.make({ uuid })),
    Effect.mapError(TrajectoryError.decode),
  );

  const parts = stream.pipe(
    Stream.provideContext(sourceContext),
    Stream.mapError(TrajectoryError.storage),
    Stream.flatMap((turn) => {
      const messages = turn.prompt.content.filter(
        (message): message is PromptMessage => message.role !== "assistant",
      );
      const prompt = Stream.fromEffect(
        metadata.pipe(Effect.map((metadata) => PromptPart.make({ ...metadata, messages }))),
      );
      const responses = Fold.fold(
        turn.response.pipe(Stream.mapError(TrajectoryError.storage)),
      ).pipe(
        Stream.mapEffect((response) =>
          metadata.pipe(Effect.map((metadata) => responsePart.make({ ...metadata, response }))),
        ),
      );

      return prompt.pipe(Stream.concat(responses));
    }),
  );

  return Object.assign(parts, { toolkit }) as Trajectory<Tools>;
});
