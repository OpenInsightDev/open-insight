import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { Effect, Exit, FileSystem } from "effect";
import * as Plugin from "./index.ts";

const write = (path: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path, content);
  });

const makePlugin = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
  yield* fs.makeDirectory(`${dir}/skills/deploy`, { recursive: true });
  yield* write(
    `${dir}/plugin.json`,
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "deployment.tools",
      version: "1.2.3",
      description: "Deployment helpers",
      keywords: ["deploy", "cicd"],
      // unknown field must be reported and ignored
      stray: "ignored",
      extensions: { "acme.dev": { votes: true } },
    }),
  );
  yield* write(`${dir}/skills/deploy/SKILL.md`, "---\nname: deploy\n---\n# Deploy\n");
  yield* write(
    `${dir}/mcp.json`,
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        validator: { type: "stdio", command: "./bin/validator" },
      },
    }),
  );
  return dir;
});

layer(NodeServices.layer)((it) => {
  it.effect("validates a conformant plugin and returns its metadata", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* makePlugin;
        const plugin = yield* Plugin.validate(dir);
        // the validated plugin is a Plugin instance carrying its directory path
        assert.isTrue(plugin instanceof Plugin.Plugin);
        assert.isTrue(typeof plugin.root === "string" && plugin.root.length > 0);
        assert.strictEqual(plugin.name, "deployment.tools");
        assert.strictEqual(plugin.version, "1.2.3");
        assert.deepEqual(plugin.keywords, ["deploy", "cicd"]);
        assert.deepEqual(plugin.extensions, { "acme.dev": { votes: true } });
        assert.deepEqual(
          plugin.skills.map((s) => s.name),
          ["deploy"],
        );
        assert.deepEqual(
          plugin.mcpServers.map((m) => m.name),
          ["validator"],
        );
        // the unknown field is non-fatal and surfaces as a warning
        assert.isTrue(plugin.warnings.some((w) => w.includes("stray")));
      }),
    ),
  );

  it.effect("rejects a missing plugin.json", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
        const exit = yield* Effect.exit(Plugin.validate(dir));
        assert.isTrue(Exit.isFailure(exit));
      }),
    ),
  );

  it.effect("rejects an unsupported $schema", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
        yield* write(
          `${dir}/plugin.json`,
          JSON.stringify({ $schema: "https://example.com/other.json", name: "x" }),
        );
        const exit = yield* Effect.exit(Plugin.validate(dir));
        assert.isTrue(Exit.isFailure(exit));
      }),
    ),
  );

  it.effect("rejects an invalid plugin name", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
        yield* write(
          `${dir}/plugin.json`,
          JSON.stringify({ $schema: Plugin.PluginSchemaId, name: "Bad-Name" }),
        );
        const exit = yield* Effect.exit(Plugin.validate(dir));
        assert.isTrue(Exit.isFailure(exit));
      }),
    ),
  );

  it.effect("ignores a non-object extensions field without rejecting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
        yield* write(
          `${dir}/plugin.json`,
          JSON.stringify({ $schema: Plugin.PluginSchemaId, name: "ok.plugin", extensions: "nope" }),
        );
        const plugin = yield* Plugin.validate(dir);
        assert.strictEqual(plugin.name, "ok.plugin");
        assert.isTrue(plugin.warnings.some((w) => w.includes("extensions")));
      }),
    ),
  );

  it.effect("disables MCP without rejecting when mcp.json is invalid", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectory({ prefix: "plugin-" });
        yield* write(
          `${dir}/plugin.json`,
          JSON.stringify({ $schema: Plugin.PluginSchemaId, name: "ok.plugin" }),
        );
        yield* write(`${dir}/mcp.json`, "{ not json ");
        const plugin = yield* Plugin.validate(dir);
        assert.deepEqual(plugin.mcpServers, []);
        assert.isTrue(plugin.warnings.some((w) => w.includes("mcp.json")));
      }),
    ),
  );
});
