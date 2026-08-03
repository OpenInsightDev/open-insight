import type { Stream as AcpStream } from "@agentclientprotocol/sdk";
import {
  createHttpStream,
  type HttpStreamOptions as SdkHttpStreamOptions,
} from "@agentclientprotocol/sdk/experimental/http-client";
import {
  createWebSocketStream,
  type WebSocketStreamOptions as SdkWebSocketStreamOptions,
} from "@agentclientprotocol/sdk/experimental/ws-client";
import { Effect } from "effect";
import { Error } from "./error.ts";

export type HttpStreamOptions = SdkHttpStreamOptions;
export type WebSocketStreamOptions = SdkWebSocketStreamOptions;

const ignorePromiseFailure = (evaluate: () => Promise<void>) =>
  Effect.tryPromise(evaluate).pipe(Effect.ignore);

const closeStream = (stream: AcpStream) => ignorePromiseFailure(() => stream.writable.close());

const acquireStream = (url: URL, make: () => AcpStream) =>
  Effect.acquireRelease(
    Effect.try({ try: make, catch: Error.http(url.href, "connect") }),
    closeStream,
  );

const parseUrl = (
  input: string | URL,
  protocols: ReadonlyArray<string>,
): Effect.Effect<URL, Error> => {
  const displayUrl = typeof input === "string" ? input : input.href;
  return Effect.try({
    try: () => {
      const url = new URL(input);
      if (!protocols.includes(url.protocol)) {
        throw new globalThis.Error(`ACP transport requires a ${protocols.join(" or ")} URL`);
      }
      return url;
    },
    catch: Error.http(displayUrl, "parse-url"),
  });
};

const responseDetail = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => "");
  const summary = `${response.status} ${response.statusText}`.trim();
  return body.length === 0 ? summary : `${summary}: ${body}`;
};

const checkedFetch =
  (url: URL, fetch: typeof globalThis.fetch | undefined) =>
  async (...args: Parameters<typeof globalThis.fetch>): Promise<Response> => {
    try {
      const response = await (fetch ?? globalThis.fetch)(...args);
      if (!response.ok) {
        throw Error.httpResponse(url.href, response.status, await responseDetail(response));
      }
      return response;
    } catch (cause) {
      throw Error.http(url.href, "request")(cause);
    }
  };

const openSdkHttpStream = (url: URL, options: HttpStreamOptions) =>
  acquireStream(url, () =>
    createHttpStream(url.href, {
      ...options,
      fetch: checkedFetch(url, options.fetch),
    }),
  );

const openSdkWebSocketStream = (url: URL, options: WebSocketStreamOptions) =>
  acquireStream(url, () => createWebSocketStream(url.href, options));

/** Opens the Streamable HTTP transport: JSON POST requests and an SSE response stream. */
export const openHttpStream = Effect.fn("Acp.openHttpStream")(function* (
  input: string | URL,
  options: HttpStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["http:", "https:"]);
  return yield* openSdkHttpStream(url, options);
});

/** Opens the ACP WebSocket transport, which sends and receives JSON-RPC text frames. */
export const openWebSocketStream = Effect.fn("Acp.openWebSocketStream")(function* (
  input: string | URL,
  options: WebSocketStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["ws:", "wss:"]);
  return yield* openSdkWebSocketStream(url, options);
});

/** Opens the published ACP transport selected by the URL scheme. */
export const openStream = Effect.fn("Acp.openStream")(function* (
  input: string | URL,
  options: HttpStreamOptions & WebSocketStreamOptions = {},
) {
  const url = yield* parseUrl(input, ["http:", "https:", "ws:", "wss:"]);
  return yield* url.protocol === "http:" || url.protocol === "https:"
    ? openSdkHttpStream(url, options)
    : openSdkWebSocketStream(url, options);
});
