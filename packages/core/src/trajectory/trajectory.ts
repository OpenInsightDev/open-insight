import { Effect, Queue, Schema, Stream, type Cause } from "effect";
import { Prompt, Tool, Response, Toolkit } from "effect/unstable/ai";
import { fold } from "../response/fold.ts";
import { TrajectoryError } from "./error.ts";

export type PromptMessage = Exclude<Prompt.Message, Prompt.AssistantMessage>;
export type PromptMessageEncoded = Exclude<Prompt.MessageEncoded, Prompt.AssistantMessageEncoded>;

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

export type StreamTurnEncodedStream<E, R> = Stream.Stream<
  PromptMessageEncoded | Response.AllPartsEncoded,
  E,
  R
>;

export const make = Effect.fn(function* <E, R, Toolkits extends ReadonlyArray<Toolkit.Any>>(
  stream: StreamTurnEncodedStream<E, R>,
  ...toolkits: Toolkits
) {
  const merged = Toolkit.merge(...toolkits);
  type Tools = Toolkit.MergedTools<Toolkits>;
  type Part = Response.AllPartsView<Tools>;
  type PartQueue = Queue.Queue<Part, TrajectoryError | Cause.Done>;

  const promptMessage = Schema.Union([
    Prompt.SystemMessage,
    Prompt.UserMessage,
    Prompt.ToolMessage,
  ]);
  const responsePart = Response.AllPartsView(merged);
  const decodePrompt = Schema.decodeEffect(promptMessage);
  const decodeResponse = Schema.decodeEffect(responsePart);
  const context = yield* Effect.context<R | typeof responsePart.DecodingServices>();

  const turns = () =>
    Stream.callback<Turn<Tools>, TrajectoryError>(
      Effect.fn(function* (output) {
        let prompt: PromptMessage[] = [];
        let responseQueue: PartQueue | undefined;

        const endResponse = Effect.fn(function* () {
          if (responseQueue !== undefined) {
            yield* Queue.end(responseQueue);
            responseQueue = undefined;
          }
        });

        const offerResponse = Effect.fn(function* (part: Part) {
          if (responseQueue === undefined) {
            responseQueue = yield* Queue.unbounded<Part, TrajectoryError | Cause.Done>();
            yield* Queue.offer(output, {
              prompt,
              response: fold(Stream.fromQueue(responseQueue)),
            });
            prompt = [];
          }
          yield* Queue.offer(responseQueue, part);
        });

        const succeeded = yield* stream.pipe(
          Stream.mapError(TrajectoryError.storage),
          Stream.runForEach(
            Effect.fn(function* (value) {
              if ("role" in value) {
                const message = yield* decodePrompt(value).pipe(
                  Effect.mapError(TrajectoryError.decode),
                );
                const startsNextTurn = responseQueue !== undefined;
                yield* endResponse();
                prompt = startsNextTurn ? [message] : [...prompt, message];
                return;
              }

              const part = yield* decodeResponse(value).pipe(
                Effect.mapError(TrajectoryError.decode),
              );
              yield* offerResponse(part);
            }),
          ),
          Effect.provide(context),
          Effect.as(true),
          Effect.catch(
            Effect.fn(function* (error) {
              if (responseQueue !== undefined) {
                yield* Queue.fail(responseQueue, error);
              }
              yield* Queue.fail(output, error);
              return false;
            }),
          ),
        );

        if (!succeeded) {
          return;
        }
        yield* endResponse();
        if (prompt.length > 0 && responseQueue === undefined) {
          yield* Queue.offer(output, { prompt, response: Stream.empty });
        }
        yield* Queue.end(output);
      }),
    );

  return { toolkit: merged, turns } satisfies Trajectory<Tools>;
});
