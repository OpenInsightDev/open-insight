/**
 * Agent Plugins specification version and its canonical schema identifiers.
 *
 * The Agent Plugins format is versioned as a single release that bundles the
 * specification text, the plugin manifest schema, and the MCP configuration
 * schema under one version. This mirrors §10.1 of the specification: every
 * release publishes both schemas with the same version.
 *
 * See: https://agent-plugins.org/ (Agent Plugins Specification 1.0.0)
 */
export const Version = "1.0.0" as const;
export type Version = typeof Version;

/** Canonical plugin manifest schema identifier for {@link Version}. */
export const ManifestSchemaId =
  `https://agent-plugins.org/schemas/${Version}/plugin.schema.json` as const;
export type ManifestSchemaId = typeof ManifestSchemaId;

/** Canonical MCP configuration schema identifier for {@link Version}. */
export const McpSchemaId = `https://agent-plugins.org/schemas/${Version}/mcp.schema.json` as const;
export type McpSchemaId = typeof McpSchemaId;
