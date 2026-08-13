import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

const failure = Schema.String;

const pathResult = Schema.Struct({
  path: Schema.String,
});

const searchMatch = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int,
  match: Schema.String,
  lineText: Schema.String,
});

/** Read a UTF-8 text file. */
export const ReadFile = Tool.make("ReadFile", {
  description:
    "Read up to maxBytes of a UTF-8 text file (64 KiB by default). Line numbers are 1-based and inclusive.",
  parameters: Schema.Struct({
    path: Schema.String,
    startLine: Schema.optionalKey(Schema.Int),
    endLine: Schema.optionalKey(Schema.Int),
    maxBytes: Schema.optionalKey(Schema.Int),
  }),
  success: Schema.String,
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

const searchParameters = Schema.Struct({
  path: Schema.String,
  pattern: Schema.String,
  flags: Schema.optionalKey(Schema.String),
});

/** Search a file or every file below a directory with a JavaScript regular expression. */
export const Search = Tool.make("Search", {
  description:
    "Search a UTF-8 text file, or recursively search all files in a directory, using a JavaScript regular expression. Returns every match with its 1-based line and column. The global flag is enabled automatically.",
  parameters: searchParameters,
  success: Schema.Array(searchMatch),
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem, Path.Path],
});

/** Write (or replace) a UTF-8 file. */
export const WriteFile = Tool.make("WriteFile", {
  description: "Write UTF-8 content to a file, replacing existing content unless append is true.",
  parameters: Schema.Struct({
    path: Schema.String,
    content: Schema.String,
    append: Schema.optionalKey(Schema.Boolean),
  }),
  success: pathResult,
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

/** Create a directory, optionally creating missing parent directories. */
export const MakeDirectory = Tool.make("MakeDirectory", {
  description: "Create a directory.",
  parameters: Schema.Struct({
    path: Schema.String,
    recursive: Schema.optionalKey(Schema.Boolean),
  }),
  success: pathResult,
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

/** List names in a directory. */
export const ReadDirectory = Tool.make("ReadDirectory", {
  description: "List entries in a directory.",
  parameters: Schema.Struct({
    path: Schema.String,
    recursive: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Array(Schema.String),
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

/** Remove a file or directory. */
export const Remove = Tool.make("Remove", {
  description: "Remove a file or directory.",
  parameters: Schema.Struct({
    path: Schema.String,
    recursive: Schema.optionalKey(Schema.Boolean),
    force: Schema.optionalKey(Schema.Boolean),
  }),
  success: pathResult,
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

/** Copy a file or directory. */
export const Copy = Tool.make("Copy", {
  description: "Copy a file or directory.",
  parameters: Schema.Struct({
    fromPath: Schema.String,
    toPath: Schema.String,
    overwrite: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    fromPath: Schema.String,
    toPath: Schema.String,
  }),
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

/** Rename a file or directory. */
export const Rename = Tool.make("Rename", {
  description: "Rename or move a file or directory; set overwrite to replace the destination.",
  parameters: Schema.Struct({
    fromPath: Schema.String,
    toPath: Schema.String,
    overwrite: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({
    fromPath: Schema.String,
    toPath: Schema.String,
  }),
  failure,
  failureMode: "return",
  dependencies: [FileSystem.FileSystem],
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toolkit = Toolkit.make(
  ReadFile,
  Search,
  WriteFile,
  MakeDirectory,
  ReadDirectory,
  Remove,
  Copy,
  Rename,
);

export type Tools = Toolkit.Tools<typeof toolkit>;

type SearchParameters = Schema.Schema.Type<typeof searchParameters>;

const searchFile = Effect.fn("Fs.SearchFile")(function* (file: string, expression: RegExp) {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs.readFileString(file).pipe(Effect.mapError(errorMessage));
  const matches = [];
  for (const found of content.matchAll(new RegExp(expression.source, expression.flags))) {
    const index = found.index ?? 0;
    const lineStart = content.lastIndexOf("\n", index - 1) + 1;
    const lineEnd = content.indexOf("\n", index);
    matches.push({
      path: file,
      line: content.slice(0, index).split("\n").length,
      column: index - lineStart + 1,
      match: found[0],
      lineText: content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd),
    });
  }
  return matches;
});

const search = Effect.fn("Fs.Search")(function* ({ path: root, pattern, flags }: SearchParameters) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const expression = yield* Effect.try({
    try: () => new RegExp(pattern, flags?.includes("g") === true ? flags : `${flags ?? ""}g`),
    catch: (error) => `Invalid regular expression: ${errorMessage(error)}`,
  });
  const info = yield* fs.stat(root).pipe(Effect.mapError(errorMessage));
  const files =
    info.type === "File"
      ? [root]
      : yield* fs.readDirectory(root, { recursive: true }).pipe(
          Effect.map((entries) => entries.map((entry) => path.join(root, entry))),
          Effect.flatMap((entries) =>
            Effect.forEach(
              entries,
              (entry) =>
                fs.stat(entry).pipe(
                  Effect.map((stat) => (stat.type === "File" ? entry : undefined)),
                  Effect.mapError(errorMessage),
                ),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.map((entries) => entries.filter((entry): entry is string => entry !== undefined)),
          Effect.mapError(errorMessage),
        );
  const perFile = yield* Effect.forEach(files, (file) => searchFile(file, expression), {
    concurrency: "unbounded",
  });
  return perFile.flat();
});

export const layer = toolkit.toLayer({
  ReadFile: Effect.fn(function* ({ path, startLine, endLine, maxBytes }) {
    const fs = yield* FileSystem.FileSystem;
    const decoder = new TextDecoder();
    const content = yield* fs
      .stream(path, {
        chunkSize: FileSystem.Size(16 * 1024),
        bytesToRead: FileSystem.Size(maxBytes ?? 64 * 1024),
      })
      .pipe(
        Stream.runFold(
          () => "",
          (text, chunk) => text + decoder.decode(chunk, { stream: true }),
        ),
        Effect.map((text) => text + decoder.decode()),
        Effect.mapError(errorMessage),
      );
    if (startLine === undefined && endLine === undefined) return content;
    const lines = content.split("\n");
    const from = Math.max(0, (startLine ?? 1) - 1);
    const to = endLine ?? lines.length;
    return lines.slice(from, to).join("\n");
  }),
  Search: search,
  WriteFile: Effect.fn(function* ({ path, content, append }) {
    const fs = yield* FileSystem.FileSystem;
    const nextContent =
      append === true
        ? `${yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""))}${content}`
        : content;
    return yield* fs
      .writeFileString(path, nextContent)
      .pipe(Effect.as({ path }), Effect.mapError(errorMessage));
  }),
  MakeDirectory: Effect.fn(function* ({ path, recursive }) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .makeDirectory(path, { recursive: recursive ?? false })
      .pipe(Effect.as({ path }), Effect.mapError(errorMessage));
  }),
  ReadDirectory: Effect.fn(function* ({ path, recursive }) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .readDirectory(path, { recursive: recursive ?? false })
      .pipe(Effect.mapError(errorMessage));
  }),
  Remove: Effect.fn(function* ({ path, recursive, force }) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .remove(path, {
        recursive: recursive ?? false,
        force: force ?? false,
      })
      .pipe(Effect.as({ path }), Effect.mapError(errorMessage));
  }),
  Copy: Effect.fn(function* ({ fromPath, toPath, overwrite }) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .copy(fromPath, toPath, { overwrite: overwrite ?? false })
      .pipe(Effect.as({ fromPath, toPath }), Effect.mapError(errorMessage));
  }),
  Rename: Effect.fn(function* ({ fromPath, toPath, overwrite }) {
    const fs = yield* FileSystem.FileSystem;
    if (overwrite === true) {
      yield* fs.remove(toPath, { recursive: true, force: true }).pipe(Effect.ignore);
    }
    return yield* fs
      .rename(fromPath, toPath)
      .pipe(Effect.as({ fromPath, toPath }), Effect.mapError(errorMessage));
  }),
});
