import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import { CustomServer, Server, StdioServer } from "../src/mcp/config.ts";

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
