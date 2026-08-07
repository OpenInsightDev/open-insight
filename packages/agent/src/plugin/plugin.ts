import { Schema } from "effect";
import { Manifest } from "./manifest.ts";
import { McpServer } from "./mcp.ts";

/**
 * A skill (§7.1).
 *
 * A skill is discovered at the fixed location `skills/`: each immediate child
 * directory containing a `SKILL.md` regular file is one skill. The
 * `SKILL.md` format itself is governed by the Agent Skills specification and
 * is outside this module.
 */
export class Skill extends Schema.Class<Skill>("AgentPluginsSkill")({
  /** The immediate child directory name under `skills/`. */
  name: Schema.String,
  /** Plugin-relative path to the skill directory within the plugin root. */
  path: Schema.String,
}) {}

/**
 * A plugin component (§3): a skill or an MCP server entry.
 */
export const Component = Schema.Union([Skill, McpServer]);
export type Component = Schema.Schema.Type<typeof Component>;

/**
 * An Agent Plugins package loaded from a directory (§3, §4).
 *
 * A plugin is a self-contained directory rooted at a single filesystem
 * location, carrying a manifest and optional components. Only valid components
 * are present; invalid or misconfigured components are isolated and skipped by
 * the loader (§6.2, §7.2.2).
 */
export class Plugin extends Schema.Class<Plugin>("AgentPluginsPlugin")({
  /** Absolute, filesystem-resolved plugin root (§3). */
  root: Schema.String,
  /** The `plugin.json` manifest (§5). */
  manifest: Manifest,
  /** The plugin's valid components (§3): skills and MCP servers. */
  components: Schema.Array(Component),
}) {}
