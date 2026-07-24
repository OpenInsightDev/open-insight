import { Effect, Schema, Stream } from "effect";
import type { EventTransport } from "../service.ts";
import { Error } from "../error.ts";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Sse } from "effect/unstable/encoding";
import { Event, type EventStream } from "../schema.ts";

const joinUrl = (baseURL: string, path: string): string =>
  new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();

const eventStream = (stream: EventStream): Stream.Stream<Uint8Array, Error> =>
  stream.pipe(
    Stream.mapEffect((value) =>
      Schema.encodeEffect(Event)(value).pipe(
        Effect.map((data) => ({
          _tag: "Event" as const,
          event: value._tag,
          id: undefined,
          data: JSON.stringify(data),
        })),
        Effect.mapError(Error.invalid),
      ),
    ),
    Stream.map((event) => Sse.encoder.write(event)),
    Stream.encodeText,
  );

export const make = Effect.fn(function* ({
  baseUrl = "http://localhost:7689",
  endpoint = "/event",
}: Readonly<{
  baseUrl?: string;
  endpoint?: string;
}> = {}): Effect.fn.Return<EventTransport, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  return {
    send: Effect.fn(function* (stream) {
      const url = joinUrl(baseUrl, endpoint);
      const body = HttpBody.stream(eventStream(stream), "text/event-stream; charset=utf-8");

      yield* client
        .post(url, { body })
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.mapError(Error.delivery));
    }),
  } satisfies EventTransport;
});
