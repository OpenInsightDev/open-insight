import { Context, Effect, pipe, Scope, Sink, Stream } from "effect";
import type { OpenFlag, SizeInput } from "effect/FileSystem";
import { badArgument, type PlatformError } from "effect/PlatformError";
import { SandboxError } from "./error.ts";

export class FileSystem extends Context.Service<
  FileSystem,
  {
    /**
     * Checks whether a file can be accessed.
     * You can optionally specify the level of access to check for.
     */
    readonly access: (
      path: string,
      options?: {
        readonly ok?: boolean;
        readonly readable?: boolean;
        readonly writable?: boolean;
      },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Copy a file or directory from `fromPath` to `toPath`.
     *
     * **Details**
     *
     * Equivalent to `cp -r`.
     */
    readonly copy: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Copy a file from `fromPath` to `toPath`.
     */
    readonly copyFile: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Glob a directory.
     */
    readonly glob: (
      pattern: string,
      options?: {
        readonly root?: string;
        readonly exclude?: ReadonlyArray<string>;
      },
    ) => Effect.Effect<ReadonlyArray<string>, SandboxError>;

    /**
     * Checks whether a path exists.
     */
    readonly exists: (path: string) => Effect.Effect<boolean, SandboxError>;

    /**
     * Create a directory at `path`. You can optionally specify whether to recursively create nested directories.
     */
    readonly makeDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Create a temporary directory.
     *
     * **Details**
     *
     * By default the directory will be created inside the system's default
     * temporary directory, but you can specify a different location by setting
     * the `directory` option.
     *
     * You can also specify a prefix for the directory name by setting the
     * `prefix` option.
     */
    readonly makeTempDirectory: (options?: {
      readonly directory?: string | undefined;
      readonly prefix?: string | undefined;
    }) => Effect.Effect<string, SandboxError>;

    /**
     * Create a temporary directory inside a scope.
     *
     * **Details**
     *
     * Functionally equivalent to `makeTempDirectory`, but the directory will be
     * automatically deleted when the scope is closed.
     */
    readonly makeTempDirectoryScoped: (options?: {
      readonly directory?: string | undefined;
      readonly prefix?: string | undefined;
    }) => Effect.Effect<string, SandboxError, Scope.Scope>;

    /**
     * Create a temporary file.
     * The directory creation is functionally equivalent to `makeTempDirectory`.
     * The file name will be a randomly generated string.
     */
    readonly makeTempFile: (options?: {
      readonly directory?: string | undefined;
      readonly prefix?: string | undefined;
      readonly suffix?: string | undefined;
    }) => Effect.Effect<string, SandboxError>;
    /**
     * Create a temporary file inside a scope.
     *
     * **Details**
     *
     * Functionally equivalent to `makeTempFile`, but the file will be
     * automatically deleted when the scope is closed.
     */
    readonly makeTempFileScoped: (options?: {
      readonly directory?: string | undefined;
      readonly prefix?: string | undefined;
      readonly suffix?: string | undefined;
    }) => Effect.Effect<string, SandboxError, Scope.Scope>;

    /**
     * List the contents of a directory.
     *
     * **Details**
     *
     * You can recursively list the contents of nested directories by setting the
     * `recursive` option.
     */
    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<ReadonlyArray<string>, SandboxError>;

    /**
     * Read the contents of a file.
     */
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, SandboxError>;

    /**
     * Read the contents of a file.
     */
    readonly readFileString: (
      path: string,
      encoding?: string,
    ) => Effect.Effect<string, SandboxError>;

    /**
     * Remove a file or directory.
     */
    readonly remove: (
      path: string,
      options?: { readonly recursive?: boolean; readonly force?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Rename a file or directory.
     */
    readonly rename: (
      oldPath: string,
      newPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Create a writable `Sink` for the specified `path`.
     */
    readonly sink: (
      path: string,
      options?: {
        readonly flag?: OpenFlag | undefined;
        readonly mode?: number | undefined;
      },
    ) => Sink.Sink<void, Uint8Array, never, SandboxError>;

    /**
     * Get information about a file at `path`.
     */
    readonly stat: (path: string) => Effect.Effect<ResourceInfo, SandboxError>;

    /**
     * Create a readable `Stream` for the specified `path`.
     *
     * **Details**
     *
     * Changing the `bufferSize` option will change the internal buffer size of
     * the stream. It defaults to `4`.
     *
     * The `chunkSize` option will change the size of the chunks emitted by the
     * stream. It defaults to 64kb.
     *
     * Changing `offset` and `bytesToRead` will change the offset and the number
     * of bytes to read from the file.
     */
    readonly stream: (
      path: string,
      options?: {
        readonly bytesToRead?: bigint;
        readonly chunkSize?: bigint;
        readonly offset?: bigint;
      },
    ) => Stream.Stream<Uint8Array, SandboxError>;

    /**
     * Truncate a file to a specified length. If the `length` is not specified,
     * the file will be truncated to length `0`.
     */
    readonly truncate: (path: string, length?: SizeInput) => Effect.Effect<void, SandboxError>;

    /**
     * Write data to a file at `path`.
     */
    readonly writeFile: (
      path: string,
      data: Uint8Array,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, SandboxError>;

    /**
     * Write a string to a file at `path`.
     */
    readonly writeFileString: (
      path: string,
      data: string,
      options?: { readonly overwrite?: boolean; readonly encoding?: string },
    ) => Effect.Effect<void, SandboxError>;
  }
>()("@open-insight/agent/fs/FileSystem") {}

export type FileSystemService = FileSystem["Service"];

type PlatformImplementation<T> = T extends (
  ...args: infer Arguments
) => Effect.Effect<infer A, SandboxError, infer Requirements>
  ? (...args: Arguments) => Effect.Effect<A, PlatformError, Requirements>
  : T extends (...args: infer Arguments) => Stream.Stream<infer A, SandboxError, infer Requirements>
    ? (...args: Arguments) => Stream.Stream<A, PlatformError, Requirements>
    : T extends (
          ...args: infer Arguments
        ) => Sink.Sink<infer A, infer In, infer Leftover, SandboxError, infer Requirements>
      ? (...args: Arguments) => Sink.Sink<A, In, Leftover, PlatformError, Requirements>
      : never;

type CoreFileSystem = {
  readonly [Key in keyof Omit<
    FileSystemService,
    "exists" | "readFileString" | "stream" | "writeFileString"
  >]: PlatformImplementation<
    Omit<FileSystemService, "exists" | "readFileString" | "stream" | "writeFileString">[Key]
  >;
};

const temporaryPath = (directory: string | undefined): string => directory ?? "temporary directory";

const mapPlatformError = <A, Requirements>(
  operation: string,
  path: string,
  effect: Effect.Effect<A, PlatformError, Requirements>,
): Effect.Effect<A, SandboxError, Requirements> =>
  effect.pipe(Effect.mapError(SandboxError.fileSystem(operation, path)));

/**
 * Creates a FileSystem implementation from WebDAV core operations.
 *
 * The derived stream reads the resource once and chunks the result locally;
 * an adapter that supports HTTP Range can provide a more efficient override.
 */
export const make = (impl: CoreFileSystem): FileSystemService =>
  FileSystem.of({
    access: (path, options) => mapPlatformError("access", path, impl.access(path, options)),
    copy: (fromPath, toPath, options) =>
      mapPlatformError("copy", `${fromPath} -> ${toPath}`, impl.copy(fromPath, toPath, options)),
    copyFile: (fromPath, toPath, options) =>
      mapPlatformError(
        "copyFile",
        `${fromPath} -> ${toPath}`,
        impl.copyFile(fromPath, toPath, options),
      ),
    glob: (pattern, options) => mapPlatformError("glob", pattern, impl.glob(pattern, options)),
    exists: (path) =>
      pipe(
        impl.access(path),
        Effect.as(true),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(false)
            : Effect.fail(SandboxError.fileSystem("exists", path)(error)),
        ),
      ),
    makeDirectory: (path, options) =>
      mapPlatformError("makeDirectory", path, impl.makeDirectory(path, options)),
    makeTempDirectory: (options) =>
      mapPlatformError(
        "makeTempDirectory",
        temporaryPath(options?.directory),
        impl.makeTempDirectory(options),
      ),
    makeTempDirectoryScoped: (options) =>
      mapPlatformError(
        "makeTempDirectoryScoped",
        temporaryPath(options?.directory),
        impl.makeTempDirectoryScoped(options),
      ),
    makeTempFile: (options) =>
      mapPlatformError(
        "makeTempFile",
        temporaryPath(options?.directory),
        impl.makeTempFile(options),
      ),
    makeTempFileScoped: (options) =>
      mapPlatformError(
        "makeTempFileScoped",
        temporaryPath(options?.directory),
        impl.makeTempFileScoped(options),
      ),
    readDirectory: (path, options) =>
      mapPlatformError("readDirectory", path, impl.readDirectory(path, options)),
    readFile: (path) => mapPlatformError("readFile", path, impl.readFile(path)),
    readFileString: (path, encoding = "utf-8") =>
      Effect.flatMap(impl.readFile(path), (data) =>
        Effect.try({
          try: () => new TextDecoder(encoding).decode(data),
          catch: (cause) =>
            badArgument({
              module: "FileSystem",
              method: "readFileString",
              description: "invalid encoding",
              cause,
            }),
        }),
      ).pipe(Effect.mapError(SandboxError.fileSystem("readFileString", path))),
    remove: (path, options) => mapPlatformError("remove", path, impl.remove(path, options)),
    rename: (oldPath, newPath, options) =>
      mapPlatformError(
        "rename",
        `${oldPath} -> ${newPath}`,
        impl.rename(oldPath, newPath, options),
      ),
    sink: (path, options) =>
      impl.sink(path, options).pipe(Sink.mapError(SandboxError.fileSystem("sink", path))),
    stat: (path) => mapPlatformError("stat", path, impl.stat(path)),
    stream: (path, options) =>
      Stream.unwrap(
        impl.readFile(path).pipe(
          Effect.mapError(SandboxError.fileSystem("stream", path)),
          Effect.map((data) => {
            const offset = options?.offset ?? 0n;
            const bytesToRead = options?.bytesToRead;
            const chunkSize = options?.chunkSize ?? 64n * 1024n;

            if (offset < 0n || chunkSize <= 0n || (bytesToRead !== undefined && bytesToRead < 0n)) {
              return Stream.fail(
                SandboxError.fileSystem(
                  "stream",
                  path,
                )(
                  badArgument({
                    module: "FileSystem",
                    method: "stream",
                    description:
                      "offset, bytesToRead, and chunkSize must be non-negative and chunkSize must be positive",
                  }),
                ),
              );
            }

            const start = Number(offset);
            const end = bytesToRead === undefined ? data.length : start + Number(bytesToRead);
            const selected = data.slice(start, end);
            const size = Number(chunkSize);
            const chunks = Array.from({ length: Math.ceil(selected.length / size) }, (_, index) =>
              selected.slice(index * size, (index + 1) * size),
            );
            return Stream.fromIterable(chunks);
          }),
        ),
      ),
    truncate: (path, length) => mapPlatformError("truncate", path, impl.truncate(path, length)),
    writeFile: (path, data, options) =>
      mapPlatformError("writeFile", path, impl.writeFile(path, data, options)),
    writeFileString: (path, data, options) =>
      Effect.suspend(() => {
        if (options?.encoding !== undefined && options.encoding.toLowerCase() !== "utf-8") {
          return Effect.fail(
            badArgument({
              module: "FileSystem",
              method: "writeFileString",
              description: "only utf-8 encoding is supported",
            }),
          );
        }
        return impl.writeFile(path, new TextEncoder().encode(data), options);
      }).pipe(Effect.mapError(SandboxError.fileSystem("writeFileString", path))),
  });

/** Metadata that can be represented by WebDAV properties. */
export interface ResourceInfo {
  /** `Directory` represents a WebDAV collection; other resources are `File`. */
  readonly type: "File" | "Directory";
  readonly size?: bigint;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly creationDate?: Date;
  readonly contentType?: string;
}
