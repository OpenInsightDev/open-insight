import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { PluginError } from "./error.ts";
import { Manifest } from "./manifest.ts";
import { McpServer } from "./mcp.ts";
import { Component, Plugin, Skill } from "./plugin.ts";
import { McpSchemaId } from "./version.ts";

/**
 * Top-level `mcp.json` shell used by the loader. It validates the required
 * `$schema` (version) and `mcpServers` map, leaving each server entry to be
 * decoded and isolated individually (§7.2.1, §7.2.2).
 */
const McpShell = Schema.Struct({
  $schema: Schema.Literal(McpSchemaId),
  mcpServers: Schema.Record(Schema.String, Schema.Unknown),
});

/** True when `candidate` is `root` itself or lies within it (§4.1). */
const isWithin = Effect.fn(function* (root: string, candidate: string) {
  const path = yield* Path.Path;
  const rel = path.relative(root, candidate);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
});

/**
 * Normalize `candidate` against the plugin root and check it stays within it
 * (§4.1). This is a structural containment check; it does not require the
 * target to already exist (a bundled executable is created at install time).
 */
const isResolvedWithin = Effect.fn(function* (root: string, candidate: string) {
  const path = yield* Path.Path;
  return yield* isWithin(root, path.resolve(root, candidate));
});

/** True when `file` is a regular file within the plugin root (§4.1, §7.1). */
const isRegularFileWithin = Effect.fn(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(file).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") return false;
  return yield* isResolvedWithin(root, file);
});

const loadManifest = Effect.fn(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const file = root + "/plugin.json";
  const exists = Option.getOrElse(yield* fs.exists(file).pipe(Effect.option), () => false);
  if (!exists) return yield* Effect.fail(PluginError.manifestMissing(root));

  const text = yield* fs
    .readFileString(file)
    .pipe(Effect.mapError((cause) => PluginError.manifestInvalid(root, cause)));
  const unknown = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => PluginError.manifestInvalid(root, cause),
  });
  return yield* Schema.decodeUnknownEffect(Manifest)(unknown).pipe(
    Effect.mapError((cause) => PluginError.manifestInvalid(root, cause)),
  );
});

const loadSkills = Effect.fn(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillsDir = path.join(root, "skills");

  const exists = Option.getOrElse(yield* fs.exists(skillsDir).pipe(Effect.option), () => false);
  if (!exists) return [];

  const dirStat = yield* fs.stat(skillsDir).pipe(Effect.option);
  if (Option.isNone(dirStat) || dirStat.value.type !== "Directory") {
    yield* Effect.logWarning(`Agent plugin "skills" location is not a directory: ${skillsDir}`);
    return [];
  }

  const names = Option.getOrElse(yield* fs.readDirectory(skillsDir).pipe(Effect.option), () => []);
  const skills: Array<Skill> = [];
  for (const name of names) {
    const skillDir = path.join(skillsDir, name);
    const info = yield* fs.stat(skillDir).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "Directory") continue;
    // A skill is an immediate child directory containing a SKILL.md regular
    // file that does not escape the plugin root (§6.1, §7.1).
    if (!(yield* isRegularFileWithin(root, path.join(skillDir, "SKILL.md")))) {
      yield* Effect.logWarning(`Skipping invalid skill "${name}"`);
      continue;
    }
    skills.push(Skill.make({ name, path: `skills/${name}` }));
  }
  return skills;
});

/** Whether a stdio server's plugin-relative paths stay within the plugin root (§7.2.1). */
const serverWithin = Effect.fn(function* (root: string, server: McpServer) {
  if (server.type !== "stdio") return true;

  // Plugin-relative `command` must stay within the plugin root (§7.2.1).
  if (server.command.startsWith("./")) {
    if (!(yield* isResolvedWithin(root, server.command))) return false;
  }
  // `cwd` must stay within the plugin root for `./` and `${PLUGIN_ROOT}` forms;
  // `${PLUGIN_DATA}` is client-managed and checked at runtime.
  const cwd = server.cwd;
  if (cwd !== undefined) {
    if (cwd.startsWith("./")) {
      if (!(yield* isResolvedWithin(root, cwd))) return false;
    } else if (cwd.startsWith("${PLUGIN_ROOT}")) {
      const resolved = cwd === "${PLUGIN_ROOT}" ? root : root + cwd.slice("${PLUGIN_ROOT}".length);
      if (!(yield* isResolvedWithin(root, resolved))) return false;
    }
  }
  return true;
});

const loadMcpServers = Effect.fn(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(root, "mcp.json");

  const exists = Option.getOrElse(yield* fs.exists(file).pipe(Effect.option), () => false);
  if (!exists) return [];

  const info = yield* fs.stat(file).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "File") {
    yield* Effect.logWarning(`Agent plugin "mcp" location is not a file: ${file}`);
    return [];
  }

  const text = yield* fs.readFileString(file).pipe(Effect.option);
  if (Option.isNone(text)) {
    yield* Effect.logWarning(`Agent plugin "mcp" configuration is unreadable: ${file}`);
    return [];
  }

  const unknown = yield* Effect.try({
    try: () => JSON.parse(text.value) as unknown,
    catch: (cause) => cause,
  }).pipe(Effect.option);
  if (Option.isNone(unknown)) {
    yield* Effect.logWarning(`Agent plugin "mcp" configuration is not valid JSON: ${file}`);
    return [];
  }

  // A top-level failure — invalid or targeting an unsupported / conflicting
  // version — disables MCP for the plugin without affecting other components
  // (§7.2.2, §10.1).
  const shell = yield* Schema.decodeUnknownEffect(McpShell)(unknown.value).pipe(Effect.option);
  if (Option.isNone(shell)) {
    yield* Effect.logWarning(`Agent plugin "mcp" configuration is invalid or unsupported: ${file}`);
    return [];
  }

  // Validate and isolate each server entry independently (§7.2.2): an invalid
  // or non-conforming server is skipped while the others are kept.
  const servers: Array<McpServer> = [];
  for (const [name, value] of Object.entries(shell.value.mcpServers)) {
    const server = yield* Schema.decodeUnknownEffect(McpServer)(value).pipe(Effect.option);
    if (Option.isNone(server) || !(yield* serverWithin(root, server.value))) {
      yield* Effect.logWarning(`Skipping invalid MCP server "${name}"`);
      continue;
    }
    servers.push(server.value);
  }
  return servers;
});

/**
 * Load a plugin from a directory.
 *
 * Checks the manifest at `plugin.json` (fatal on absence or invalidity, §5),
 * then discovers components at their fixed locations (§6): skills under
 * `skills/` and MCP servers from `mcp.json`. Component failures are isolated
 * and logged, never fatal (§6.2, §7.2.2, §11.3).
 *
 * @requires the {@link FileSystem} and {@link Path} services.
 */
export const load = Effect.fn(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;

  const stat = yield* fs
    .stat(root)
    .pipe(Effect.mapError((cause) => PluginError.rootInvalid(root, cause)));
  if (stat.type !== "Directory") {
    return yield* Effect.fail(PluginError.rootInvalid(root, new Error("not a directory")));
  }
  const rootPath = yield* fs
    .realPath(root)
    .pipe(Effect.mapError((cause) => PluginError.rootInvalid(root, cause)));

  const manifest = yield* loadManifest(rootPath);

  const components: Array<Component> = [];
  components.push(...(yield* loadSkills(rootPath)));
  components.push(...(yield* loadMcpServers(rootPath)));

  return Plugin.make({ root: rootPath, manifest, components });
});
