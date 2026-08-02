import { type AnyMessage, ndJsonStream, type Stream as AcpStream } from "@agentclientprotocol/sdk";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Undici from "@effect/platform-node/Undici";
import { Effect, Stream } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { Error } from "./error.ts";

const CONTENT_TYPE = "application/octet-stream";

export interface HttpStreamOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

const ignorePromiseFailure = (evaluate: () => Promise<void>) =>
  Effect.tryPromise(evaluate).pipe(Effect.ignore);

const makeDispatcher = (url: URL) =>
  Effect.acquireRelease(
    Effect.try({
      try: () =>
        new Undici.H2CClient(url.origin, {
          bodyTimeout: 0,
          maxConcurrentStreams: 1,
          pipelining: 1,
        }),
      catch: Error.http(url.href, "connect"),
    }),
    (dispatcher) => ignorePromiseFailure(() => dispatcher.destroy()),
  );

const makeRequestBody = Effect.acquireRelease(
  Effect.sync(() => new TransformStream<Uint8Array, Uint8Array>()),
  (body) => ignorePromiseFailure(() => body.writable.abort()),
);

const closeableNdJsonStream = (
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
): AcpStream => {
  const stream = ndJsonStream(output, input);

  return {
    readable: stream.readable,
    writable: new WritableStream<AnyMessage>({
      async write(message) {
        const writer = stream.writable.getWriter();
        try {
          await writer.write(message);
        } finally {
          writer.releaseLock();
        }
      },
      async close() {
        await stream.writable.close();
        await output.close();
      },
      async abort(reason) {
        await Promise.allSettled([stream.writable.abort(reason), output.abort(reason)]);
      },
    }),
  };
};

const parseUrl = (input: string | URL): Effect.Effect<URL, Error> => {
  const displayUrl = typeof input === "string" ? input : input.href;
  return Effect.try({
    try: () => {
      const url = new URL(input);
      if (url.protocol !== "http:") {
        throw new globalThis.Error("ACP h2c transport requires an http: URL");
      }
      return url;
    },
    catch: Error.http(displayUrl, "parse-url"),
  });
};

const validateResponse = (
  url: string,
  status: number,
  contentType: string | undefined,
): Effect.Effect<void, Error> => {
  if (status === 200 && contentType?.toLowerCase() === CONTENT_TYPE) {
    return Effect.void;
  }

  const detail =
    status !== 200
      ? `expected HTTP status 200, received ${status}`
      : `expected Content-Type ${CONTENT_TYPE}, received ${contentType ?? "none"}`;
  return Effect.fail(Error.httpResponse(url, status, detail));
};

/**
 * Opens the full-duplex HTTP/2 byte stream exposed by `acp-agent serve --transport http`.
 *
 * The returned ACP SDK stream uses NDJSON framing and remains valid until the surrounding
 * Effect scope closes. This is distinct from the SDK's POST + SSE Streamable HTTP transport.
 */
export const openHttpStream = Effect.fn("Acp.openHttpStream")(function* (
  input: string | URL,
  options: HttpStreamOptions = {},
) {
  const url = yield* parseUrl(input);
  const dispatcher = yield* makeDispatcher(url);
  const requestBody = yield* makeRequestBody;
  const client = yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, dispatcher),
  );
  const body = Stream.fromReadableStream({
    evaluate: () => requestBody.readable,
    onError: Error.http(url.href, "request"),
  });
  const request = HttpClientRequest.post(url, { headers: options.headers }).pipe(
    HttpClientRequest.bodyStream(body, { contentType: CONTENT_TYPE }),
  );
  const response = yield* client
    .execute(request)
    .pipe(
      Effect.mapError((cause) =>
        Error.http(url.href, cause.reason._tag === "TransportError" ? "connect" : "request")(cause),
      ),
    );

  yield* validateResponse(url.href, response.status, response.headers["content-type"]);

  const responseBody = yield* Stream.toReadableStreamEffect(
    Stream.mapError(response.stream, Error.http(url.href, "response")),
  );
  return closeableNdJsonStream(requestBody.writable, responseBody);
});
