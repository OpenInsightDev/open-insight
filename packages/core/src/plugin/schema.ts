import { Schema } from "effect";

/** The canonical Agent Plugins manifest schema identifier supported by this client. */
export const PluginSchemaId = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** Fixed location, relative to the plugin root, where skills are discovered. */
export const SkillsDir = "skills";

/** Fixed location, relative to the plugin root, of the MCP configuration document. */
export const McpConfigFile = "mcp.json";

/** Fixed file name of a skill's frontmatter-and-instructions document. */
export const SkillMarkdownFile = "SKILL.md";

/** Canonical name format: 1–64 lowercase ASCII letters/digits/hyphens/periods. */
export const PluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** The canonical manifest schema identifier as a decodeable Schema. */
export const ManifestSchemaId = Schema.Literal(PluginSchemaId);

/** A valid plugin name, per the canonical `name` pattern. */
export const PluginName = Schema.String.check(
  Schema.isPattern(PluginNamePattern, { expected: "a valid plugin name" }),
);
export type PluginName = Schema.Schema.Type<typeof PluginName>;

/** Closed `author` object of the manifest. */
export const Author = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});
export type Author = Schema.Schema.Type<typeof Author>;

/**
 * Schema for the known optional top-level manifest fields.
 *
 * The closed Agent Plugins manifest defines `$schema` and `name` as required
 * (handled by the loader with dedicated errors) and these fields as optional
 * metadata. Two violations are intentionally non-fatal and are handled by the
 * loader before this schema runs: unknown top-level fields and a non-object
 * `extensions` value.
 */
export const Manifest = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Author),
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type Manifest = Schema.Schema.Type<typeof Manifest>;

/** Every top-level field the closed manifest permits. */
export const KnownManifestFields = ["$schema", "name", ...Object.keys(Manifest.fields)] as const;
