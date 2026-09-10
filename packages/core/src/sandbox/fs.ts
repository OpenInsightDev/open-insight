import { Context, Effect, Layer, Scope, Sink, Stream } from "effect";
import { SandboxError } from "./error.ts";
import type { OpenFlag, SizeInput } from "effect/FileSystem";
import type { Client, FileStat } from "webdav-client";

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

export class FileSystem extends Context.Service<
  FileSystem,
  {
    /**
     * Checks whether a file can be accessed.
     */
    readonly access: (path: string) => Effect.Effect<void, SandboxError>;

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
     * Upload a host file directly to `path`.
     *
     * The implementation may use the provider's native file transfer mechanism.
     *
     * Returns the number of bytes uploaded.
     */
    readonly upload: (path: string, data: Uint8Array) => Effect.Effect<number, SandboxError>;

    /**
     * Upload a host file to `path` using a stream.
     *
     * Streaming avoids loading the complete host file into memory at once.
     *
     * Returns the number of bytes uploaded.
     */
    readonly uploadStream: <E, R>(
      path: string,
      stream: Stream.Stream<Uint8Array, E, R>,
    ) => Effect.Effect<number, SandboxError | E, R>;

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

/** An initialized WebDAV client whose `Auth`/`Transport` requirements are already satisfied. */
export type WebDAVClient = {
  readonly [K in keyof Client]: Client[K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, infer E, infer _R>
    ? (...args: Args) => Effect.Effect<A, E>
    : never;
};

export type WebDAVOptions = Readonly<{
  /** A fully-initialized WebDAV client. */
  readonly client: WebDAVClient;
}>;

const notImplemented = (name: string) =>
  Effect.die(new Error(`FileSystem.${name} is not implemented`));

const parseHttpDate = (value: string): Date | undefined => {
  if (value === "") return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
};

const toResourceInfo = (info: FileStat): ResourceInfo => {
  const lastModified = parseHttpDate(info.lastmod);
  return {
    type: info.type === "directory" ? "Directory" : "File",
    ...(info.type === "file" ? { size: BigInt(info.size) } : {}),
    ...(info.etag === null ? {} : { etag: info.etag }),
    ...(info.mime === undefined ? {} : { contentType: info.mime }),
    ...(lastModified === undefined ? {} : { lastModified }),
  };
};

export const layerWebDAV = (options: WebDAVOptions): Layer.Layer<FileSystem, SandboxError> =>
  Layer.succeed(
    FileSystem,
    FileSystem.of({
      access: (path) =>
        options.client
          .stat(path)
          .pipe(Effect.mapError(SandboxError.fileSystem("access", path)), Effect.asVoid),

      exists: (path) =>
        options.client.exists(path).pipe(Effect.mapError(SandboxError.fileSystem("exists", path))),

      stat: (path) =>
        options.client
          .stat(path)
          .pipe(Effect.mapError(SandboxError.fileSystem("stat", path)), Effect.map(toResourceInfo)),

      // TODO: implemented in subsequent batches.
      copy: (_fromPath, _toPath) => notImplemented("copy"),
      copyFile: (_fromPath, _toPath) => notImplemented("copyFile"),
      glob: (_pattern) => notImplemented("glob"),
      makeDirectory: (_path) => notImplemented("makeDirectory"),
      makeTempDirectory: () => notImplemented("makeTempDirectory"),
      makeTempDirectoryScoped: () => notImplemented("makeTempDirectoryScoped"),
      makeTempFile: () => notImplemented("makeTempFile"),
      makeTempFileScoped: () => notImplemented("makeTempFileScoped"),
      readDirectory: (_path) => notImplemented("readDirectory"),
      readFile: (_path) => notImplemented("readFile"),
      readFileString: (_path) => notImplemented("readFileString"),
      remove: (_path) => notImplemented("remove"),
      rename: (_oldPath, _newPath) => notImplemented("rename"),
      sink: (_path, _options) => Sink.unwrap(notImplemented("sink")),
      stream: (_path, _options) => Stream.unwrap(notImplemented("stream")),
      truncate: (_path) => notImplemented("truncate"),
      upload: (_path, _data) => notImplemented("upload"),
      uploadStream: <E, R>(_path: string, _stream: Stream.Stream<Uint8Array, E, R>) =>
        notImplemented("uploadStream"),
      writeFile: (_path, _data) => notImplemented("writeFile"),
      writeFileString: (_path, _data) => notImplemented("writeFileString"),
    }),
  );
