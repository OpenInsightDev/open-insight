import { Effect, Schema, Stream } from "effect";
import type { EventTransport } from "#/eval/event/index.ts";
import { Error } from "#/eval/error.ts";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Sse } from "effect/unstable/encoding";
import { Event, type EventStream } from "#/eval/event/schema.ts";

const transport = "sse";

const joinUrl = (baseURL: string, path: string): string =>
  new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();

const eventStream = (stream: EventStream): Stream.Stream<Uint8Array, Error | Schema.SchemaError> =>
  stream.pipe(
    Stream.map((value) => ({
      _tag: "Event" as const,
      event: value._tag,
      id: undefined,
      data: JSON.stringify(Schema.encodeSync(Event)(value)),
    })),
    Stream.map((event) => Sse.encoder.write(event)),
    Stream.encodeText,
  );

export const make = Effect.fn(function* ({
  baseUrl = "http://localhost:7689",
  endpoint = "/event",
}: Readonly<{
  baseUrl?: string;
  endpoint?: string;
}> = {}): Effect.fn.Return<EventTransport, Error, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  return {
    send: Effect.fn(function* ({ stream }) {
      const url = joinUrl(baseUrl, endpoint);
      const body = HttpBody.stream(
        eventStream(stream).pipe(Stream.mapError(Error.eventTransport(transport))),
        "text/event-stream; charset=utf-8",
      );

      yield* client
        .post(url, { body })
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.mapError(Error.eventTransportInit(transport, url)),
        );
    }),
  } satisfies EventTransport;
});
