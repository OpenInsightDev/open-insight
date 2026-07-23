import { Effect, FileSystem, Path, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { InvalidMetadataError, SourceError } from "./error.ts";
import { Metadata } from "./metadata.ts";

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const invalid = (filePath: string, cause: unknown) =>
  new InvalidMetadataError({ path: filePath, cause });

const parseFrontmatter = Effect.fn("Skills.parseFrontmatter")(function* (
  source: string,
  filePath: string,
) {
  const match = frontmatterPattern.exec(source);
  if (match === null) {
    return yield* Effect.fail(
      invalid(filePath, new globalThis.Error("SKILL.md must start with closed YAML frontmatter")),
    );
  }

  const parsed: unknown = yield* Effect.try({
    try: () => parseYaml(match[1], { uniqueKeys: true }),
    catch: (cause) => invalid(filePath, cause),
  });

  return yield* Schema.decodeUnknownEffect(Metadata, {
    errors: "all",
    onExcessProperty: "ignore",
  })(parsed).pipe(Effect.mapError((cause) => invalid(filePath, cause)));
});

const readMetadata = Effect.fn("Skills.readMetadata")(function* (
  filePath: string,
  directoryName: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError((cause) => new SourceError({ path: filePath, cause })));
  const metadata = yield* parseFrontmatter(source, filePath);

  if (metadata.name !== directoryName) {
    return yield* Effect.fail(
      invalid(
        filePath,
        new globalThis.Error(
          `Skill name ${JSON.stringify(metadata.name)} must match directory name ${JSON.stringify(directoryName)}`,
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
  const resolvedDir = path.resolve(skillsDir);
  const entries = yield* fs
    .readDirectory(resolvedDir)
    .pipe(Effect.mapError((cause) => new SourceError({ path: resolvedDir, cause })));

  const discovered = yield* Effect.all(
    entries.toSorted().map(
      Effect.fn(function* (entry) {
        const entryPath = path.join(resolvedDir, entry);
        const info = yield* fs
          .stat(entryPath)
          .pipe(Effect.mapError((cause) => new SourceError({ path: entryPath, cause })));
        if (info.type !== "Directory") {
          return undefined;
        }

        const filePath = path.join(resolvedDir, entry, "SKILL.md");
        const exists = yield* fs
          .exists(filePath)
          .pipe(Effect.mapError((cause) => new SourceError({ path: filePath, cause })));
        return exists ? { directoryName: entry, filePath } : undefined;
      }),
    ),
    { concurrency: "unbounded" },
  );

  return yield* Effect.all(
    discovered
      .filter((skill) => skill !== undefined)
      .map(({ directoryName, filePath }) => readMetadata(filePath, directoryName)),
    { concurrency: "unbounded" },
  );
});
