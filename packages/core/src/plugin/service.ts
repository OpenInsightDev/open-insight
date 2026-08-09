import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { PluginError } from "./error.ts";
import {
  KnownManifestFields,
  Manifest,
  ManifestSchemaId,
  McpConfigFile,
  PluginName,
  SkillsDir,
  SkillMarkdownFile,
  Author,
} from "./schema.ts";

/** A discovered skill component of a validated plugin. */
export class PluginSkill extends Schema.Class<PluginSkill>("PluginSkill")({
  name: Schema.String,
  path: Schema.String,
}) {}

/** A discovered MCP server entry of a validated plugin. */
export class PluginMcpServer extends Schema.Class<PluginMcpServer>("PluginMcpServer")({
  name: Schema.String,
}) {}

/**
 * A plugin whose `plugin.json` manifest passed validation, bundled with its
 * filesystem-resolved directory path and parsed metadata.
 */
export class Plugin extends Schema.Class<Plugin>("Plugin")({
  /** Filesystem-resolved plugin directory path, with symlinks followed. */
  root: Schema.String,
  name: Schema.String,
  version: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Author),
  homepage: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Client-owned manifest data keyed by reverse-domain namespace. */
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  /** Discovered skills under the fixed `skills/` location. */
  skills: Schema.Array(PluginSkill),
  /** Discovered MCP servers declared in `mcp.json`. */
  mcpServers: Schema.Array(PluginMcpServer),
  /** Non-fatal manifest and component issues that were reported and ignored. */
  warnings: Schema.Array(Schema.String),
}) {}

/** The schema for a JSON object (used for both the manifest and `mcp.json`). */
const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** Decode a JSON document string into a validated JSON object. */
const parseJsonObject = (
  raw: string,
  label: string,
): Effect.Effect<Readonly<Record<string, unknown>>, PluginError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(JsonObject))(raw).pipe(
    Effect.mapError((cause) => PluginError.invalidManifest(cause, label)),
  );

/**
 * Validate a portable Agent Plugin at `pluginDir`.
 *
 * Follows the Agent Plugins loading sequence: establish the filesystem-resolved
 * root, locate and validate the root `plugin.json` manifest against the
 * locally-supported `$schema`, discover supported component types from their
 * fixed locations, and apply failure boundaries. Returns the validated `Plugin`
 * data structure (directory path + resolved metadata), or fails with a
 * `PluginError` for fatal violations.
 */
export const validate = Effect.fn(function* (pluginDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const warnings: string[] = [];

  // 1. Establish the filesystem-resolved plugin root.
  const root = yield* fs
    .realPath(path.resolve(pluginDir))
    .pipe(Effect.mapError((cause) => PluginError.invalidPath(pluginDir, cause)));

  // 2. Locate, parse and validate the manifest at the root.
  const manifestPath = path.join(root, "plugin.json");
  const manifestExists = yield* fs
    .exists(manifestPath)
    .pipe(Effect.mapError((cause) => PluginError.invalidManifest(cause, "plugin.json")));
  if (!manifestExists) {
    yield* Effect.fail(PluginError.missingManifest(root));
  }
  const resolvedManifest = yield* fs
    .realPath(manifestPath)
    .pipe(Effect.mapError((cause) => PluginError.invalidManifest(cause, "plugin.json")));
  if (path.relative(root, resolvedManifest).startsWith("..")) {
    yield* Effect.fail(
      PluginError.invalidManifest(
        new Error("plugin.json resolves outside the plugin root"),
        "plugin.json",
      ),
    );
  }
  const rawManifest = yield* fs
    .readFileString(manifestPath)
    .pipe(Effect.mapError((cause) => PluginError.invalidManifest(cause, "plugin.json")));
  const parsed = yield* parseJsonObject(rawManifest, "plugin.json");

  // 3. Non-fatal: report and ignore unknown top-level fields.
  const knownFields = new Set<string>(KnownManifestFields);
  for (const key of Object.keys(parsed)) {
    if (!knownFields.has(key)) {
      warnings.push(`Ignoring unknown manifest field "${key}"`);
    }
  }

  // 4. Non-fatal: report and ignore a non-object `extensions` value.
  const extensionsInvalid = Option.isNone(
    Schema.decodeUnknownOption(JsonObject)(parsed["extensions"]),
  );
  if (extensionsInvalid) {
    warnings.push('Ignoring non-object manifest field "extensions"');
  }

  // 5. Fatal: the manifest must declare a supported canonical schema.
  const schemaId = parsed["$schema"];
  if (!Option.isSome(Schema.decodeUnknownOption(ManifestSchemaId)(schemaId))) {
    yield* Effect.fail(
      PluginError.unsupportedSchema(typeof schemaId === "string" ? schemaId : undefined),
    );
  }

  // 6. Fatal: the manifest must declare a valid plugin name.
  const name = yield* Schema.decodeUnknownEffect(PluginName)(parsed["name"]).pipe(
    Effect.mapError((cause) => PluginError.invalidManifest(cause, "name")),
  );

  // 7. Fatal: any other manifest schema violation (optional field types).
  const metadataInput: Record<string, unknown> = { ...parsed };
  if (extensionsInvalid) delete metadataInput.extensions;
  const metadata = yield* Schema.decodeUnknownEffect(Manifest)(metadataInput).pipe(
    Effect.mapError((cause) => PluginError.invalidManifest(cause)),
  );

  // 8. Discover supported component types from their fixed locations, applying
  // the narrowest failure boundary: a broken component type disables only that
  // type (a warning) and never rejects the plugin.

  // Skills: immediate children of skills/ containing a regular SKILL.md.
  const skills: PluginSkill[] = [];
  yield* Effect.gen(function* () {
    const dir = path.join(root, SkillsDir);
    if (!(yield* fs.exists(dir))) return;
    if ((yield* fs.stat(dir)).type !== "Directory") {
      warnings.push('Ignoring "skills" location: not a directory');
      return;
    }
    for (const entry of yield* fs.readDirectory(dir)) {
      const markdown = path.join(dir, entry, SkillMarkdownFile);
      if (!(yield* fs.exists(markdown))) continue;
      if ((yield* fs.stat(markdown)).type === "File") {
        skills.push(new PluginSkill({ name: entry, path: path.join(dir, entry) }));
      } else {
        warnings.push(`Skipping skill "${entry}": ${SkillMarkdownFile} is not a regular file`);
      }
    }
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => warnings.push('Ignoring "skills" components: discovery failed')),
    ),
  );

  // MCP servers: one root mcp.json document. A broken document disables MCP;
  // an invalid entry disables only that entry.
  const mcpServers: PluginMcpServer[] = [];
  yield* Effect.gen(function* () {
    const file = path.join(root, McpConfigFile);
    if (!(yield* fs.exists(file))) return;
    if ((yield* fs.stat(file)).type !== "File") {
      warnings.push('Ignoring "mcp.json": not a regular file');
      return;
    }
    const mcpRaw = yield* fs.readFileString(file);
    const mcpParsed = yield* parseJsonObject(mcpRaw, "mcp.json");
    const servers = Schema.decodeUnknownOption(JsonObject)(mcpParsed["mcpServers"]);
    if (Option.isNone(servers)) {
      warnings.push('Ignoring "mcp.json": invalid MCP configuration');
      return;
    }
    for (const [serverName, value] of Object.entries(servers.value)) {
      if (Schema.is(JsonObject)(value)) {
        mcpServers.push(new PluginMcpServer({ name: serverName }));
      } else {
        warnings.push(`Skipping MCP server "${serverName}": invalid configuration`);
      }
    }
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => warnings.push('Ignoring "mcp.json": MCP configuration could not be read')),
    ),
  );

  return new Plugin({ root, name, ...metadata, skills, mcpServers, warnings });
});
