import { Context, Effect, pipe, Stream } from "effect";
import { badArgument, type PlatformError } from "effect/PlatformError";

export class FileSystem extends Context.Service<
  FileSystem,
  {
    readonly access: (
      path: string,
      options?: {
        readonly ok?: boolean;
        readonly readable?: boolean;
        readonly writable?: boolean;
      },
    ) => Effect.Effect<void, PlatformError>;

    readonly copy: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly copyFile: (
      fromPath: string,
      toPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly exists: (path: string) => Effect.Effect<boolean, PlatformError>;

    readonly glob: (
      pattern: string,
      options?: {
        readonly root?: string;
        readonly exclude?: ReadonlyArray<string>;
      },
    ) => Effect.Effect<ReadonlyArray<string>, PlatformError>;

    readonly makeDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly readDirectory: (
      path: string,
      options?: { readonly recursive?: boolean },
    ) => Effect.Effect<ReadonlyArray<string>, PlatformError>;

    readonly readFile: (path: string) => Effect.Effect<Uint8Array, PlatformError>;

    readonly readFileString: (
      path: string,
      encoding?: string,
    ) => Effect.Effect<string, PlatformError>;

    readonly remove: (
      path: string,
      options?: { readonly recursive?: boolean; readonly force?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly rename: (
      oldPath: string,
      newPath: string,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly stat: (path: string) => Effect.Effect<ResourceInfo, PlatformError>;

    readonly stream: (
      path: string,
      options?: {
        readonly bytesToRead?: bigint;
        readonly chunkSize?: bigint;
        readonly offset?: bigint;
      },
    ) => Stream.Stream<Uint8Array, PlatformError>;

    readonly writeFile: (
      path: string,
      data: Uint8Array,
      options?: { readonly overwrite?: boolean },
    ) => Effect.Effect<void, PlatformError>;

    readonly writeFileString: (
      path: string,
      data: string,
      options?: { readonly overwrite?: boolean; readonly encoding?: string },
    ) => Effect.Effect<void, PlatformError>;
  }
>()("@open-insight/agent/fs/FileSystem") {}

export type FileSystemService = FileSystem["Service"];

type CoreFileSystem = Omit<
  FileSystemService,
  "exists" | "readFileString" | "stream" | "writeFileString"
>;

/**
 * Creates a FileSystem implementation from WebDAV core operations.
 *
 * The derived stream reads the resource once and chunks the result locally;
 * an adapter that supports HTTP Range can provide a more efficient override.
 */
export const make = (impl: CoreFileSystem): FileSystemService =>
  FileSystem.of({
    ...impl,
    exists: (path) =>
      pipe(
        impl.access(path),
        Effect.as(true),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(error),
        ),
      ),
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
      ),
    stream: (path, options) =>
      Stream.unwrap(
        Effect.map(impl.readFile(path), (data) => {
          const offset = options?.offset ?? 0n;
          const bytesToRead = options?.bytesToRead;
          const chunkSize = options?.chunkSize ?? 64n * 1024n;

          if (offset < 0n || chunkSize <= 0n || (bytesToRead !== undefined && bytesToRead < 0n)) {
            return Stream.fail(
              badArgument({
                module: "FileSystem",
                method: "stream",
                description:
                  "offset, bytesToRead, and chunkSize must be non-negative and chunkSize must be positive",
              }),
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
      }),
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
