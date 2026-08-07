import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { Manifest, ManifestSchemaId, McpConfig, McpSchemaId, McpServer } from "./index.ts";

const decode = Schema.decodeUnknownSync;

describe("Manifest", () => {
  it("decodes a minimal manifest", () => {
    const manifest = decode(Manifest)({
      $schema: ManifestSchemaId,
      name: "minimal-plugin",
    });
    expect(manifest.name).toBe("minimal-plugin");
  });

  it("decodes a full manifest", () => {
    const manifest = decode(Manifest)({
      $schema: ManifestSchemaId,
      name: "plugin-name",
      version: "1.2.0",
      description: "Brief plugin description",
      author: { name: "Author Name" },
      keywords: ["keyword1", "keyword2"],
      extensions: { "com.example.client": { setting: true } },
    });
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.author?.name).toBe("Author Name");
  });

  it("rejects an invalid plugin name", () => {
    expect(() => decode(Manifest)({ $schema: ManifestSchemaId, name: "My-Plugin" })).toThrow();
  });

  it("rejects a name with consecutive hyphens", () => {
    expect(() => decode(Manifest)({ $schema: ManifestSchemaId, name: "has--double" })).toThrow();
  });
});

describe("McpConfig", () => {
  it("decodes the spec stdio example", () => {
    const config = decode(McpConfig)({
      $schema: McpSchemaId,
      mcpServers: {
        "local-validator": {
          type: "stdio",
          command: "./bin/validator",
          args: ["--data", "${PLUGIN_DATA}/validator"],
          env: { CONFIG: "${PLUGIN_ROOT}/config.json" },
          cwd: "${PLUGIN_ROOT}",
        },
      },
    });
    const server = config.mcpServers["local-validator"];
    expect(server.type).toBe("stdio");
    if (server.type === "stdio") {
      expect(server.cwd).toBe("${PLUGIN_ROOT}");
    }
  });

  it("decodes remote streamable-http and sse servers", () => {
    const config = decode(McpConfig)({
      $schema: McpSchemaId,
      mcpServers: {
        api: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: { "X-Tenant": "t" },
        },
        legacy: { type: "sse", url: "https://legacy.example.com/sse" },
      },
    });
    expect(config.mcpServers.api.type).toBe("streamable-http");
    expect(config.mcpServers.legacy.type).toBe("sse");
  });

  it("is a discriminated union narrowed on the type field", () => {
    const server = decode(McpServer)({ type: "stdio", command: "npx" });
    if (server.type === "stdio") {
      expect(server.command).toBe("npx");
    } else {
      throw new Error("expected stdio");
    }
  });

  it("rejects a stdio env containing a reserved PLUGIN_ROOT entry", () => {
    expect(() =>
      decode(McpConfig)({
        $schema: McpSchemaId,
        mcpServers: { bad: { type: "stdio", command: "npx", env: { PLUGIN_ROOT: "/x" } } },
      }),
    ).toThrow();
  });

  it("rejects a cwd that escapes the plugin root", () => {
    expect(() =>
      decode(McpConfig)({
        $schema: McpSchemaId,
        mcpServers: { bad: { type: "stdio", command: "./bin", cwd: "../bin" } },
      }),
    ).toThrow();
  });

  it("rejects an unknown server type", () => {
    expect(() =>
      decode(McpConfig)({
        $schema: McpSchemaId,
        mcpServers: { bad: { type: "nope", url: "x" } },
      }),
    ).toThrow();
  });
});
