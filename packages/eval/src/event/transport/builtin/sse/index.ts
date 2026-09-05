import { Context, Effect, Schema, Stream } from "effect";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Sse } from "effect/unstable/encoding";
import { EventError } from "../../../error.ts";
import { Event } from "../../../schema.ts";
import type { Transport } from "../../service.ts";

const joinUrl = (baseUrl: string, endpoint: string): string =>
  new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

const eventStream = (stream: Stream.Stream<Event>): Stream.Stream<Uint8Array, EventError> =>
  stream.pipe(
    Stream.mapEffect((value) =>
      Schema.encodeEffect(Event)(value).pipe(
        Effect.map((data) => ({
          _tag: "Event" as const,
          event: value._tag,
          id: undefined,
          data: JSON.stringify(data),
        })),
        Effect.mapError(EventError.invalid),
      ),
    ),
    Stream.map(Sse.encoder.write),
    Stream.encodeText,
    Stream.provideContext(Context.empty()),
  );

export const make = Effect.fn(function* ({
  baseUrl = "http://localhost:7689",
  endpoint = "/event",
}: Readonly<{
  readonly baseUrl?: string;
  readonly endpoint?: string;
}> = {}): Effect.fn.Return<Transport, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  return {
    send: Effect.fn(function* (stream) {
      const body = HttpBody.stream(eventStream(stream), "text/event-stream; charset=utf-8");

      yield* client
        .post(joinUrl(baseUrl, endpoint), { body })
        .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.mapError(EventError.send));
    }),
  } satisfies Transport;
});
