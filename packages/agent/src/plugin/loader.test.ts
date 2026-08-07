import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { ManifestSchemaId, McpSchemaId, PluginError, load } from "./index.ts";

/** Create a temp plugin directory populated from a `path -> content` map. */
const fixture = (files: Record<string, string>): string => {
  const dir = FS.mkdtempSync(NodePath.join(OS.tmpdir(), "agent-plugin-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = NodePath.join(dir, rel);
    FS.mkdirSync(NodePath.dirname(file), { recursive: true });
    FS.writeFileSync(file, content);
  }
  return dir;
};

const manifest = (name = "demo") => JSON.stringify({ $schema: ManifestSchemaId, name });

/** Yield the plugin, or the `PluginError` on failure. */
const attempt = <A, R>(effect: Effect.Effect<A, PluginError, R>) =>
  effect.pipe(Effect.catchTag("PluginError", (error) => Effect.succeed(error)));

describe("load", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("loads a full plugin with a skill and MCP servers", () =>
      Effect.gen(function* () {
        const root = fixture({
          "plugin.json": manifest(),
          "skills/greet/SKILL.md": "---\nname: greet\n---\nGreet.",
          "mcp.json": JSON.stringify({
            $schema: McpSchemaId,
            mcpServers: {
              local: { type: "stdio", command: "./bin/server" },
              api: { type: "streamable-http", url: "https://example.com/mcp" },
            },
          }),
        });

        const plugin = yield* load(root);
        assert.strictEqual(plugin.manifest.name, "demo");
        assert.strictEqual(plugin.components.length, 3);

        const [skill, stdio, http] = plugin.components;
        if ("type" in skill) throw new Error("expected a skill first");
        assert.strictEqual(skill.name, "greet");
        assert.strictEqual(skill.path, "skills/greet");
        if (!("type" in stdio) || !("type" in http)) throw new Error("expected MCP servers");
        assert.strictEqual(stdio.type, "stdio");
        assert.strictEqual(http.type, "streamable-http");
      }),
    );

    it.effect("accepts a manifest-only plugin", () =>
      Effect.gen(function* () {
        const root = fixture({ "plugin.json": manifest() });
        const plugin = yield* load(root);
        assert.strictEqual(plugin.components.length, 0);
      }),
    );

    it.effect("ignores a missing skills location", () =>
      Effect.gen(function* () {
        const root = fixture({ "plugin.json": manifest() });
        const plugin = yield* load(root);
        assert.strictEqual(plugin.components.length, 0);
      }),
    );

    it.effect("fails when the plugin root is not a directory", () =>
      Effect.gen(function* () {
        const file = NodePath.join(OS.tmpdir(), `not-a-dir-${Date.now()}`);
        FS.writeFileSync(file, "x");
        const result = yield* attempt(load(file));
        assert.ok(result instanceof PluginError);
        assert.strictEqual(result.reason._tag, "RootInvalid");
      }),
    );

    it.effect("fails when the manifest is missing", () =>
      Effect.gen(function* () {
        const root = fixture({ "skills/a/SKILL.md": "x" });
        const result = yield* attempt(load(root));
        assert.ok(result instanceof PluginError);
        assert.strictEqual(result.reason._tag, "ManifestMissing");
      }),
    );

    it.effect("fails when the manifest is invalid", () =>
      Effect.gen(function* () {
        const root = fixture({
          "plugin.json": JSON.stringify({ $schema: ManifestSchemaId, name: "Bad Name" }),
        });
        const result = yield* attempt(load(root));
        assert.ok(result instanceof PluginError);
        assert.strictEqual(result.reason._tag, "ManifestInvalid");
      }),
    );

    it.effect("disables MCP but keeps skills when mcp.json is invalid", () =>
      Effect.gen(function* () {
        const root = fixture({
          "plugin.json": manifest(),
          "skills/greet/SKILL.md": "x",
          "mcp.json": JSON.stringify({
            $schema: "https://agent-plugins.org/schemas/0.9.0/mcp.schema.json",
            mcpServers: {},
          }),
        });
        const plugin = yield* load(root);
        assert.strictEqual(plugin.components.length, 1);
        if ("type" in plugin.components[0]) throw new Error("expected a skill");
        assert.strictEqual(plugin.components[0].name, "greet");
      }),
    );

    it.effect("skips individual invalid servers but keeps valid ones", () =>
      Effect.gen(function* () {
        const root = fixture({
          "plugin.json": manifest(),
          "mcp.json": JSON.stringify({
            $schema: McpSchemaId,
            mcpServers: {
              good: { type: "stdio", command: "./bin/server" },
              bad: { type: "stdio", command: "./bin/server", env: { PLUGIN_ROOT: "/x" } },
            },
          }),
        });
        const plugin = yield* load(root);
        assert.strictEqual(plugin.components.length, 1);
        if (!("type" in plugin.components[0])) throw new Error("expected an MCP server");
        assert.strictEqual(plugin.components[0].type, "stdio");
      }),
    );

    it.effect("skips unknown transport type", () =>
      Effect.gen(function* () {
        const root = fixture({
          "plugin.json": manifest(),
          "mcp.json": JSON.stringify({
            $schema: McpSchemaId,
            mcpServers: { weird: { type: "magic", url: "x" } },
          }),
        });
        const plugin = yield* load(root);
        assert.strictEqual(plugin.components.length, 0);
      }),
    );
  });
});
