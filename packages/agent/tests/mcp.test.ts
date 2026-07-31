import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as Mcp from "#/mcp/index.ts";

it("decodes schema-backed MCP server configuration", () => {
  const server = Schema.decodeUnknownSync(Mcp.Server)({
    _tag: "Stdio",
    name: "filesystem",
    command: "node",
    args: ["server.mjs"],
  });

  assert.instanceOf(server, Mcp.StdioServer);
  assert.strictEqual(server.name, "filesystem");
  assert.deepStrictEqual(server.args, ["server.mjs"]);
});

it.effect("validates custom MCP transports structurally", () =>
  Effect.gen(function* () {
    const [transport] = InMemoryTransport.createLinkedPair();
    const valid = yield* Schema.decodeUnknownEffect(Mcp.Server)({
      _tag: "Custom",
      name: "memory",
      transport,
    });
    const invalid = Schema.decodeUnknownExit(Mcp.Server)({
      _tag: "Custom",
      name: "invalid",
      transport: {},
    });

    assert.instanceOf(valid, Mcp.CustomServer);
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
      Mcp.connectScoped(Mcp.fromTransport("failing-server", transport)).pipe(Effect.flip),
    );

    assert.instanceOf(error, Mcp.Error);
    assert.instanceOf(error.reason, Mcp.ClientError);
    assert.strictEqual(error.reason.operation, "connect");
    assert.include(error.message, 'MCP server "failing-server" failed during connect');
    assert.strictEqual(error.cause, error.reason);
    assert.isTrue(closed);
  }),
);
