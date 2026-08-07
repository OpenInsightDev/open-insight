import { Schema } from "effect";
import { McpSchemaId } from "./version.ts";

/**
 * Working directory constraint for stdio servers (§7.2.1).
 *
 * `cwd` must be a `./`-relative path, exactly `${PLUGIN_ROOT}` or
 * `${PLUGIN_DATA}`, or a path rooted at either placeholder. Filesystem
 * containment after resolution is validated separately by the loader.
 */
const cwdPattern = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;

/**
 * Environment variables supplied to a stdio server subprocess (§7.2.1, §9.2).
 *
 * An `env` object MUST NOT contain entries named `PLUGIN_ROOT` or
 * `PLUGIN_DATA`; such an entry makes the server configuration invalid.
 */
const StdioEnv = Schema.Record(Schema.String, Schema.String).check(
  Schema.makeFilter((env) => !("PLUGIN_ROOT" in env) && !("PLUGIN_DATA" in env), {
    expected: "an env object with no PLUGIN_ROOT or PLUGIN_DATA entries",
  }),
);

/** A stdio MCP server configuration (§7.2.1). */
export const StdioServer = Schema.Struct({
  type: Schema.Literal("stdio"),
  /** Executable token to launch (bare name or `./`-relative path). */
  command: Schema.NonEmptyString,
  /** Arguments passed to the executable. */
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Environment variables supplied to the process. */
  env: Schema.optionalKey(StdioEnv),
  /** Working directory for the process (plugin-root or data-root rooted). */
  cwd: Schema.optionalKey(Schema.String.check(Schema.isPattern(cwdPattern))),
});
export type StdioServer = Schema.Schema.Type<typeof StdioServer>;

/** Fixed HTTP headers sent when connecting to a remote MCP server (§7.2.1). */
export const Headers = Schema.Record(Schema.String, Schema.String);
export type Headers = Schema.Schema.Type<typeof Headers>;

/** A Streamable HTTP MCP server configuration (§7.2.1). */
export const StreamableHttpServer = Schema.Struct({
  type: Schema.Literal("streamable-http"),
  /** MCP endpoint URL. */
  url: Schema.NonEmptyString,
  /** Fixed HTTP headers sent when connecting to the configured origin. */
  headers: Schema.optionalKey(Headers),
});
export type StreamableHttpServer = Schema.Schema.Type<typeof StreamableHttpServer>;

/** A legacy HTTP+SSE MCP server configuration (§7.2.1). */
export const SseServer = Schema.Struct({
  type: Schema.Literal("sse"),
  /** MCP endpoint URL. */
  url: Schema.NonEmptyString,
  /** Fixed HTTP headers sent when connecting to the configured origin. */
  headers: Schema.optionalKey(Headers),
});
export type SseServer = Schema.Schema.Type<typeof SseServer>;

/**
 * One MCP server instance (§7.2.1).
 *
 * Each server configuration MUST contain a `type` field and match exactly one
 * of the closed variants (`stdio`, `streamable-http`, or `sse`). The `type`
 * literal discriminates the union during decoding.
 */
export const McpServer = Schema.Union([StdioServer, StreamableHttpServer, SseServer]);
export type McpServer = Schema.Schema.Type<typeof McpServer>;

/**
 * The `mcp.json` configuration (§7.2.1).
 *
 * `mcp.json` MUST be a JSON object containing the required `$schema` and
 * `mcpServers` fields, with no other top-level fields. `mcpServers` is an
 * object whose member names identify servers and whose member values are
 * server configuration objects; an empty object is valid.
 */
export class McpConfig extends Schema.Class<McpConfig>("AgentPluginsMcpConfig")({
  /** Canonical MCP configuration schema identifier for the targeted Agent Plugins version. */
  $schema: Schema.Literal(McpSchemaId),
  /** Named MCP server configurations. */
  mcpServers: Schema.Record(Schema.String, McpServer),
}) {}
