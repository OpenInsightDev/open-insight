import { Schema } from "effect";
import { ManifestSchemaId } from "./version.ts";

/**
 * Plugin name constraint (§5.5): 1-64 characters, restricted to `[a-z0-9.-]`,
 * starts and ends with an alphanumeric character, and contains no `--` or
 * `..` (mirrors the `pattern` and length checks of the manifest schema).
 */
const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/**
 * Author metadata (§5.4). A closed object whose `name`, `email`, and `url`
 * members are all optional strings.
 */
export const Author = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});
export type Author = Schema.Schema.Type<typeof Author>;

/**
 * Client-specific manifest data (§8.1), keyed by reverse-domain extension
 * namespace, whose member values are objects. Agent Plugins assigns no
 * portable semantics to namespace object contents.
 */
const Extensions = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown));

/**
 * The `plugin.json` manifest (§5).
 *
 * The manifest object is closed: the only permitted top-level fields are
 * `$schema`, `name`, `version`, `description`, `author`, `homepage`,
 * `repository`, `license`, `keywords`, and `extensions`. `$schema` and `name`
 * are required.
 *
 * Note: §5.2 defines unknown top-level fields — and a non-object `extensions`
 * field — as *non-fatal* (reported and ignored). That lenient loading behavior
 * is a loader policy layered on top of this closed validation model.
 */
export class Manifest extends Schema.Class<Manifest>("AgentPluginsManifest")({
  /** Canonical plugin manifest schema identifier for the targeted Agent Plugins version. */
  $schema: Schema.Literal(ManifestSchemaId),
  /** Human-readable plugin name. */
  name: Schema.String.check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(64))
    .check(Schema.isPattern(pluginNamePattern)),
  /** Version string (Semantic Versioning recommended). */
  version: Schema.optionalKey(Schema.String),
  /** Short description of plugin purpose. */
  description: Schema.optionalKey(Schema.String),
  /** Author object with optional `name`, `email`, and `url`. */
  author: Schema.optionalKey(Author),
  /** Documentation or homepage URL. */
  homepage: Schema.optionalKey(Schema.String),
  /** Source repository URL. */
  repository: Schema.optionalKey(Schema.String),
  /** License identifier (SPDX identifier recommended). */
  license: Schema.optionalKey(Schema.String),
  /** Search and discovery tags. */
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Client-specific manifest data keyed by extension namespace. */
  extensions: Schema.optionalKey(Extensions),
}) {}
