import { Effect, FileSystem, Path, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { Error } from "./error.ts";
import { Metadata } from "./metadata.ts";

const frontmatter = /^---\r?\n([]*?)\r?\n---(?:\r?\n|$)/;

const parseFrontmatter = Effect.fn("Skills.parseFrontmatter")(function* (
  source: string,
  filePath: string,
) {
  const match = frontmatter.exec(source);
  if (match === null) {
    return yield* Effect.fail(
      Error.metadata(filePath)(
        new globalThis.Error("SKILL.md must start with closed YAML frontmatter"),
      ),
    );
  }

  const parsed: unknown = yield* Effect.try({
    try: () => parseYaml(match[1], { uniqueKeys: true }),
    catch: Error.metadata(filePath),
  });

  return yield* Schema.decodeUnknownEffect(Metadata, {
    errors: "all",
    onExcessProperty: "ignore",
  })(parsed).pipe(Effect.mapError(Error.metadata(filePath)));
});

const readMetadata = Effect.fn("Skills.readMetadata")(function* (
  filePath: string,
  dirName: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(filePath).pipe(Effect.mapError(Error.source(filePath)));
  const metadata = yield* parseFrontmatter(source, filePath);

  if (metadata.name !== dirName) {
    return yield* Effect.fail(
      Error.metadata(filePath)(
        new globalThis.Error(
          `Skill name ${JSON.stringify(metadata.name)} must match directory name ${JSON.stringify(dirName)}`,
        ),
      ),
    );
  }

  return metadata;
});

/**
 * Parses metadata from every immediate child directory containing `SKILL.md`.
 *
 * Results are ordered by directory name. Non-skill files and directories are ignored.
 */
export const fromDir = Effect.fn("Skills.fromDir")(function* (skillsDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(skillsDir);
  const entries = yield* fs.readDirectory(root).pipe(Effect.mapError(Error.source(root)));

  const discovered = yield* Effect.all(
    entries.toSorted().map(
      Effect.fn(function* (entry) {
        const entryPath = path.join(root, entry);
        const info = yield* fs.stat(entryPath).pipe(Effect.mapError(Error.source(entryPath)));
        if (info.type !== "Directory") {
          return undefined;
        }

        const filePath = path.join(root, entry, "SKILL.md");
        const exists = yield* fs.exists(filePath).pipe(Effect.mapError(Error.source(filePath)));
        return exists ? { dirName: entry, filePath } : undefined;
      }),
    ),
    { concurrency: "unbounded" },
  );

  return yield* Effect.all(
    discovered
      .filter((skill) => skill !== undefined)
      .map(({ dirName, filePath }) => readMetadata(filePath, dirName)),
    { concurrency: "unbounded" },
  );
});
