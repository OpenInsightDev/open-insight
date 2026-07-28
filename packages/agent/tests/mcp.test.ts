import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { connectScoped } from "../src/mcp/client.ts";
import { CustomServer, fromTransport, Server, StdioServer } from "../src/mcp/config.ts";
import { ClientError } from "../src/mcp/error.ts";

it("decodes schema-backed MCP server configuration", () => {
  const server = Schema.decodeUnknownSync(Server)({
    _tag: "Stdio",
    name: "filesystem",
    command: "node",
    args: ["server.mjs"],
  });

  assert.instanceOf(server, StdioServer);
  assert.strictEqual(server.name, "filesystem");
  assert.deepStrictEqual(server.args, ["server.mjs"]);
});

it.effect("validates custom MCP transports structurally", () =>
  Effect.gen(function* () {
    const [transport] = InMemoryTransport.createLinkedPair();
    const valid = yield* Schema.decodeUnknownEffect(Server)({
      _tag: "Custom",
      name: "memory",
      transport,
    });
    const invalid = Schema.decodeUnknownExit(Server)({
      _tag: "Custom",
      name: "invalid",
      transport: {},
    });

    assert.instanceOf(valid, CustomServer);
    assert.isTrue(Exit.isFailure(invalid));
  }),
);

it.effect("closes the MCP client when initialization fails", () =>
  Effect.gen(function* () {
    let closed = false;
    const transport: Transport = {
      start: () => Promise.reject(new Error("initialization failed")),
      send: () => Promise.resolve(),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };

    const error = yield* Effect.scoped(
      connectScoped(fromTransport("failing-server", transport)).pipe(Effect.flip),
    );

    assert.instanceOf(error, ClientError);
    assert.strictEqual(error.operation, "connect");
    assert.isTrue(closed);
  }),
);
