import { Context, Effect, Schema, Stream } from "effect";
import type { Transport } from "#/event/transport/service.ts";
import { EventError } from "#/event/error.ts";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Sse } from "effect/unstable/encoding";
import { EvalEvent } from "#/event/schema.ts";
import { type EventStream } from "#/event/queue.ts";

const joinUrl = (baseURL: string, path: string): string =>
  new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();

const eventStream = (stream: EventStream): Stream.Stream<Uint8Array, EventError> =>
  stream.pipe(
    Stream.mapEffect((value) =>
      Schema.encodeEffect(EvalEvent)(value).pipe(
        Effect.map((data) => ({
          _tag: "Event" as const,
          event: value._tag,
          id: undefined,
          data: JSON.stringify(data),
        })),
        Effect.mapError(EventError.invalid),
      ),
    ),
    Stream.map((event) => Sse.encoder.write(event)),
    Stream.encodeText,
    Stream.provideContext(Context.empty()),
  );

export const make = Effect.fn(function* ({
  baseUrl = "http://localhost:7689",
  endpoint = "/event",
}: Readonly<{
  baseUrl?: string;
  endpoint?: string;
}> = {}): Effect.fn.Return<Transport, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  return {
    send: Effect.fn(function* (stream) {
      const url = joinUrl(baseUrl, endpoint);
      const body = HttpBody.stream(eventStream(stream), "text/event-stream; charset=utf-8");

      yield* client
        .post(url, { body })
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.mapError(EventError.send));
    }),
  } satisfies Transport;
});
