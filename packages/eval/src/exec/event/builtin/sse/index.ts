import { Effect, Schema, Stream } from "effect";
import type { EventTransport } from "@/exec/event/index.ts";
import { ExecError } from "@/exec/error.ts";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Sse } from "effect/unstable/encoding";
import { EventSchema, type EventStream } from "@/exec/event/schema.ts";

const transport = "sse";

const joinUrl = (baseURL: string, path: string): string =>
  new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();

const encodeSseStream = <A extends { readonly _tag: string }, R>(
  encode: (value: A) => Effect.Effect<unknown, Schema.SchemaError, R>,
  stream: Stream.Stream<A, ExecError>,
): Stream.Stream<Uint8Array, ExecError | Schema.SchemaError, R> =>
  stream.pipe(
    Stream.mapEffect((value) =>
      encode(value).pipe(
        Effect.map((encoded) => ({
          _tag: "Event" as const,
          event: value._tag,
          id: undefined,
          data: JSON.stringify(encoded),
        })),
      ),
    ),
    Stream.map((event) => Sse.encoder.write(event)),
    Stream.encodeText,
  );

const eventStream = (
  stream: EventStream,
): Stream.Stream<Uint8Array, ExecError | Schema.SchemaError> =>
  encodeSseStream(Schema.encodeEffect(EventSchema), stream);

export const make = Effect.fn(function* ({
  baseURL,
}: Readonly<{
  baseURL: string;
}>): Effect.fn.Return<EventTransport, ExecError, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;

  return {
    send: Effect.fn(function* ({ stream }) {
      const url = joinUrl(baseURL, "/event");
      const body = HttpBody.stream(
        eventStream(stream).pipe(Stream.mapError(ExecError.eventTransport({ transport }))),
        "text/event-stream; charset=utf-8",
      );

      yield* client
        .post(url, { body })
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.mapError(ExecError.eventTransportInit({ transport, url })),
        );
    }),
  } satisfies EventTransport;
});
