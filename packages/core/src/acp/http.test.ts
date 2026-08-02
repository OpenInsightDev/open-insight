import { PROTOCOL_VERSION, type AnyMessage } from "@agentclientprotocol/sdk";
import { assert, it } from "@effect/vitest";
import {
  createServer,
  type Http2Server,
  type IncomingHttpHeaders,
  type ServerHttp2Stream,
} from "node:http2";
import { Effect } from "effect";
import { Error, openHttpStream } from "./index.ts";

interface TestServerOptions {
  readonly status?: number;
  readonly contentType?: string;
}

interface RunningServer {
  readonly server: Http2Server;
  readonly url: string;
  readonly requests: Array<IncomingHttpHeaders>;
  readonly streamClosed: Promise<void>;
}

const startServer = (options: TestServerOptions = {}) =>
  Effect.acquireRelease(
    Effect.callback<RunningServer, globalThis.Error>((resume) => {
      const requests: Array<IncomingHttpHeaders> = [];
      let resolveStreamClosed: () => void = () => undefined;
      const streamClosed = new Promise<void>((resolve) => {
        resolveStreamClosed = resolve;
      });
      const server = createServer();

      server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
        requests.push(headers);
        stream.once("close", resolveStreamClosed);
        stream.respond({
          ":status": options.status ?? 200,
          "content-type": options.contentType ?? "application/octet-stream",
        });

        if ((options.status ?? 200) === 200) {
          stream.pipe(stream);
        } else {
          stream.end("rejected\n");
        }
      });
      server.once("error", (cause) => resume(Effect.fail(cause)));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          resume(Effect.fail(new globalThis.Error("HTTP/2 test server has no TCP address")));
          return;
        }
        resume(
          Effect.succeed({
            server,
            url: `http://127.0.0.1:${address.port}`,
            requests,
            streamClosed,
          }),
        );
      });

      return Effect.sync(() => server.close());
    }),
    ({ server }) => Effect.sync(() => server.close()),
  );

const initializeRequest = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  },
} satisfies AnyMessage;

const transportError = (error: Error) => {
  assert.strictEqual(error.reason._tag, "AcpHttpTransportError");
  if (error.reason._tag !== "AcpHttpTransportError") {
    assert.fail(`Expected AcpHttpTransportError, received ${error.reason._tag}`);
  }
  return error.reason;
};

it.effect("bridges ACP SDK messages over the acp-agent HTTP/2 byte stream", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* startServer();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* openHttpStream(`${running.url}/agent?mode=test`, {
            headers: { authorization: "Bearer test-token" },
          });
          const writer = stream.writable.getWriter();
          const reader = stream.readable.getReader();

          yield* Effect.promise(() => writer.write(initializeRequest));
          const received = yield* Effect.promise(() => reader.read());

          assert.isFalse(received.done);
          assert.deepStrictEqual(received.value, initializeRequest);
          writer.releaseLock();
          reader.releaseLock();
        }),
      );

      yield* Effect.promise(() => running.streamClosed);
      assert.strictEqual(running.requests[0]?.[":method"], "POST");
      assert.strictEqual(running.requests[0]?.[":path"], "/agent?mode=test");
      assert.strictEqual(running.requests[0]?.["content-type"], "application/octet-stream");
      assert.strictEqual(running.requests[0]?.authorization, "Bearer test-token");
    }),
  ),
);

it.effect("ends the HTTP request stream when the ACP SDK writable closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* startServer();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* openHttpStream(running.url);
          const writer = stream.writable.getWriter();

          yield* Effect.promise(() => writer.close());
          yield* Effect.promise(() => running.streamClosed);
          writer.releaseLock();
        }),
      );
    }),
  ),
);

it.effect("rejects non-success HTTP responses with a typed transport error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* startServer({ status: 415, contentType: "text/plain" });
      const error = yield* Effect.scoped(openHttpStream(running.url)).pipe(Effect.flip);
      const reason = transportError(error);

      assert.strictEqual(reason.operation, "response");
      assert.strictEqual(reason.status, 415);
      assert.include(reason.message, "expected HTTP status 200");
    }),
  ),
);

it.effect("rejects responses with the wrong stream content type", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const running = yield* startServer({ contentType: "text/plain" });
      const error = yield* Effect.scoped(openHttpStream(running.url)).pipe(Effect.flip);
      const reason = transportError(error);

      assert.strictEqual(reason.operation, "response");
      assert.strictEqual(reason.status, 200);
      assert.include(reason.message, "expected Content-Type application/octet-stream");
    }),
  ),
);

it.effect("rejects invalid URLs before opening a connection", () =>
  Effect.gen(function* () {
    const error = yield* Effect.scoped(openHttpStream("not a url")).pipe(Effect.flip);
    const reason = transportError(error);

    assert.strictEqual(reason.operation, "parse-url");
    assert.strictEqual(reason.url, "not a url");
  }),
);

it.effect("classifies h2c connection failures as connect errors", () =>
  Effect.gen(function* () {
    const url = yield* Effect.scoped(startServer().pipe(Effect.map((running) => running.url)));
    const error = yield* Effect.scoped(openHttpStream(url)).pipe(Effect.flip);
    const reason = transportError(error);

    assert.strictEqual(reason.operation, "connect");
  }),
);

it("preserves non-Error transport causes in typed ACP errors", () => {
  const error = Error.http("http://agent.test/", "request")("stopped");
  const reason = transportError(error);

  assert.strictEqual(reason.cause, "stopped");
  assert.include(reason.message, "stopped");
});
