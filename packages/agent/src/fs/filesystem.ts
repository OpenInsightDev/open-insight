/**
 * `FileSystem.FileSystem` implementation backed by an in-memory `memfs`
 * volume.
 *
 * Every operation is translated into the `memfs` promises API and failures are
 * normalized to `PlatformError` (e.g. `ENOENT` becomes `NotFound`), matching
 * the semantics of the Node.js implementation in `@effect/platform-node`.
 *
 * The layers build a **fresh, isolated volume per build**, so each
 * `Effect.provide` boundary gets its own file system. Use `layerWith` to seed
 * the volume with a JSON directory structure, or provide `MemFs` separately
 * (via `Layer.provideMerge`) to inspect the volume after the fact.
 */
import { Effect, FileSystem, Layer, Option, PlatformError, Random, Stream, pipe } from "effect";
import { posix as Path } from "node:path";
import type { IFs, MemfsOptions, NestedDirectoryJSON } from "memfs";
import { MemFs } from "./memfs.ts";

type Stats = Awaited<ReturnType<IFs["promises"]["stat"]>>;
type FileHandle = Awaited<ReturnType<IFs["promises"]["open"]>>;

const toNumber = (value: number | bigint): number =>
  typeof value === "number" ? value : Number(value);

const toString = (value: string | Buffer): string =>
  typeof value === "string" ? value : value.toString();

const getErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = cause.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

const handleSystemError = (
  method: string,
  pathOrDescriptor: string | number,
  cause: unknown,
): PlatformError.PlatformError => {
  let reason: PlatformError.SystemErrorTag = "Unknown";
  switch (getErrorCode(cause)) {
    case "ENOENT":
      reason = "NotFound";
      break;
    case "EACCES":
      reason = "PermissionDenied";
      break;
    case "EEXIST":
      reason = "AlreadyExists";
      break;
    case "EISDIR":
    case "ENOTDIR":
    case "ELOOP":
      reason = "BadResource";
      break;
    case "EBUSY":
      reason = "Busy";
      break;
  }
  return PlatformError.systemError({
    _tag: reason,
    module: "FileSystem",
    method,
    pathOrDescriptor,
    cause,
  });
};

const makeFileInfo = (stat: Stats): FileSystem.File.Info => ({
  type: stat.isFile()
    ? "File"
    : stat.isDirectory()
      ? "Directory"
      : stat.isSymbolicLink()
        ? "SymbolicLink"
        : stat.isBlockDevice()
          ? "BlockDevice"
          : stat.isCharacterDevice()
            ? "CharacterDevice"
            : stat.isFIFO()
              ? "FIFO"
              : stat.isSocket()
                ? "Socket"
                : "Unknown",
  mtime: Option.fromNullishOr(stat.mtime),
  atime: Option.fromNullishOr(stat.atime),
  birthtime: Option.fromNullishOr(stat.birthtime),
  dev: toNumber(stat.dev),
  rdev: Option.map(Option.fromNullishOr(stat.rdev), toNumber),
  ino: Option.map(Option.fromNullishOr(stat.ino), toNumber),
  mode: toNumber(stat.mode),
  nlink: Option.map(Option.fromNullishOr(stat.nlink), toNumber),
  uid: Option.map(Option.fromNullishOr(stat.uid), toNumber),
  gid: Option.map(Option.fromNullishOr(stat.gid), toNumber),
  size: FileSystem.Size(stat.size),
  blksize: Option.map(Option.fromNullishOr(stat.blksize), (size) => FileSystem.Size(size)),
  blocks: Option.map(Option.fromNullishOr(stat.blocks), toNumber),
});

/**
 * Builds a `FileSystem.FileSystem` implementation from a `memfs` instance.
 *
 * @argument watchBackend - Optional custom watch backend, checked before
 *   falling back to `memfs`'s own directory watching.
 */
export const make = (
  fs: IFs,
  watchBackend: Option.Option<FileSystem.WatchBackend["Service"]> = Option.none(),
): FileSystem.FileSystem => {
  const { constants, promises } = fs;

  const tryOp = <A>(method: string, pathOrDescriptor: string | number, f: () => Promise<A>) =>
    Effect.tryPromise({
      try: f,
      catch: (cause) => handleSystemError(method, pathOrDescriptor, cause),
    });

  // == stat

  const stat = (path: string) =>
    Effect.map(
      tryOp("stat", path, () => promises.stat(path)),
      makeFileInfo,
    );

  // == writeFile

  const writeFileOptions = (options?: {
    readonly flag?: FileSystem.OpenFlag | undefined;
    readonly mode?: number | undefined;
  }) => ({
    ...(options?.flag !== undefined ? { flag: options.flag } : {}),
    ...(options?.mode !== undefined ? { mode: options.mode } : {}),
  });

  const writeFile: FileSystem.FileSystem["writeFile"] = (path, data, options) =>
    tryOp("writeFile", path, () => promises.writeFile(path, data, writeFileOptions(options)));

  // == readFile

  const readFile: FileSystem.FileSystem["readFile"] = (path) =>
    pipe(
      tryOp("readFile", path, () => promises.readFile(path)),
      Effect.map((data) => (typeof data === "string" ? new TextEncoder().encode(data) : data)),
    );

  // == remove

  const removeFactory =
    (method: string): FileSystem.FileSystem["remove"] =>
    (path, options) =>
      tryOp(method, path, () =>
        promises.rm(path, {
          recursive: options?.recursive ?? false,
          force: options?.force ?? false,
        }),
      );

  // == makeTempDirectory

  const makeTempDirectoryFactory = (method: string): FileSystem.FileSystem["makeTempDirectory"] =>
    Effect.fn(function* (options) {
      const directory = options?.directory ?? "/tmp";
      const prefix = options?.prefix ?? "";
      const tempRoot = prefix ? Path.join(directory, prefix) : `${directory}/`;
      yield* tryOp(method, directory, () => promises.mkdir(directory, { recursive: true }));
      const result = yield* tryOp(method, directory, () => promises.mkdtemp(tempRoot));
      return typeof result === "string" ? result : result.toString();
    });

  const makeTempDirectory = makeTempDirectoryFactory("makeTempDirectory");

  const makeTempDirectoryScoped = ((): FileSystem.FileSystem["makeTempDirectoryScoped"] => {
    const makeDirectory = makeTempDirectoryFactory("makeTempDirectoryScoped");
    const removeDirectory = removeFactory("makeTempDirectoryScoped");
    return (options) =>
      Effect.acquireRelease(makeDirectory(options), (directory) =>
        Effect.orDie(removeDirectory(directory, { recursive: true })),
      );
  })();

  // == makeTempFile

  const makeTempFileFactory = (method: string): FileSystem.FileSystem["makeTempFile"] =>
    Effect.fn(function* (options) {
      const directory = yield* makeTempDirectoryFactory(method)({
        directory: options?.directory,
        prefix: options?.prefix,
      });
      const random = yield* Random.nextIntBetween(0x100000, 0xffffff).pipe(
        Effect.map((n) => n.toString(16)),
      );
      const name = Path.join(directory, options?.suffix ? `${random}${options.suffix}` : random);
      yield* writeFile(name, new Uint8Array(0));
      return name;
    });

  const makeTempFile = makeTempFileFactory("makeTempFile");

  const makeTempFileScoped = ((): FileSystem.FileSystem["makeTempFileScoped"] => {
    const makeFile = makeTempFileFactory("makeTempFileScoped");
    const removeDirectory = removeFactory("makeTempFileScoped");
    return (options) =>
      Effect.acquireRelease(makeFile(options), (file) =>
        Effect.orDie(removeDirectory(Path.dirname(file), { recursive: true })),
      );
  })();

  // == open

  class FileImpl implements FileSystem.File {
    readonly [FileSystem.FileTypeId]: typeof FileSystem.FileTypeId = FileSystem.FileTypeId;
    readonly fd: FileSystem.File.Descriptor;
    private position: bigint = BigInt(0);

    constructor(
      private readonly handle: FileHandle,
      private readonly append: boolean,
    ) {
      this.fd = FileSystem.FileDescriptor(this.handle.fd);
    }

    get stat() {
      return Effect.map(
        tryOp("stat", this.handle.fd, () => this.handle.stat()),
        makeFileInfo,
      );
    }

    get sync() {
      return tryOp("sync", this.handle.fd, () => this.handle.datasync());
    }

    seek(offset: FileSystem.SizeInput, from: FileSystem.SeekMode) {
      const offsetSize = FileSystem.Size(offset);
      return Effect.sync(() => {
        if (from === "start") {
          this.position = offsetSize;
        } else if (from === "current") {
          this.position = this.position + offsetSize;
        }
        return this.position;
      });
    }

    read(buffer: Uint8Array) {
      return Effect.suspend(() => {
        const position = this.position;
        return Effect.map(
          tryOp("read", this.handle.fd, () =>
            this.handle.read(buffer, 0, buffer.length, Number(position)),
          ),
          ({ bytesRead }) => {
            const sizeRead = FileSystem.Size(bytesRead);
            this.position = position + sizeRead;
            return sizeRead;
          },
        );
      });
    }

    readAlloc(size: FileSystem.SizeInput) {
      const sizeNumber = Number(size);
      return Effect.suspend(() => {
        const buffer = new Uint8Array(sizeNumber);
        const position = this.position;
        return Effect.map(
          tryOp("readAlloc", this.handle.fd, () =>
            this.handle.read(buffer, 0, buffer.length, Number(position)),
          ),
          ({ bytesRead }): Option.Option<Uint8Array> => {
            if (bytesRead === 0) {
              return Option.none();
            }
            this.position = position + BigInt(bytesRead);
            return Option.some(bytesRead === sizeNumber ? buffer : buffer.slice(0, bytesRead));
          },
        );
      });
    }

    truncate(length?: FileSystem.SizeInput) {
      return Effect.map(
        tryOp("truncate", this.handle.fd, () =>
          this.handle.truncate(length !== undefined ? Number(length) : 0),
        ),
        () => {
          if (!this.append) {
            const len = BigInt(length ?? 0);
            if (this.position > len) {
              this.position = len;
            }
          }
        },
      );
    }

    write(buffer: Uint8Array) {
      return Effect.suspend(() => {
        const position = this.position;
        return Effect.map(
          tryOp("write", this.handle.fd, () =>
            this.handle.write(buffer, 0, buffer.length, this.append ? null : Number(position)),
          ),
          ({ bytesWritten }) => {
            const sizeWritten = FileSystem.Size(bytesWritten);
            if (!this.append) {
              this.position = position + sizeWritten;
            }
            return sizeWritten;
          },
        );
      });
    }

    private writeAllChunk(buffer: Uint8Array): Effect.Effect<void, PlatformError.PlatformError> {
      return Effect.suspend(() => {
        const position = this.position;
        return Effect.flatMap(
          tryOp("writeAll", this.handle.fd, () =>
            this.handle.write(buffer, 0, buffer.length, this.append ? null : Number(position)),
          ),
          ({ bytesWritten }) => {
            if (bytesWritten === 0) {
              return Effect.fail(
                PlatformError.systemError({
                  module: "FileSystem",
                  method: "writeAll",
                  _tag: "WriteZero",
                  pathOrDescriptor: this.handle.fd,
                  description: "write returned 0 bytes written",
                }),
              );
            }
            if (!this.append) {
              this.position = position + BigInt(bytesWritten);
            }
            return bytesWritten < buffer.length
              ? this.writeAllChunk(buffer.subarray(bytesWritten))
              : Effect.void;
          },
        );
      });
    }

    writeAll(buffer: Uint8Array) {
      return this.writeAllChunk(buffer);
    }
  }

  const open: FileSystem.FileSystem["open"] = (path, options) =>
    pipe(
      Effect.acquireRelease(
        tryOp("open", path, () => promises.open(path, options?.flag ?? "r", options?.mode)),
        (handle) => Effect.orDie(tryOp("close", path, () => handle.close())),
      ),
      Effect.map((handle) => new FileImpl(handle, options?.flag?.startsWith("a") ?? false)),
    );

  // == watch

  const watchMemfs = (
    path: string,
  ): Stream.Stream<FileSystem.WatchEvent, PlatformError.PlatformError> =>
    pipe(
      Stream.fromAsyncIterable(promises.watch(path, { recursive: true }), (cause) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "watch",
          pathOrDescriptor: path,
          cause,
        }),
      ),
      Stream.mapEffect(
        ({
          eventType,
          filename,
        }): Effect.Effect<FileSystem.WatchEvent, PlatformError.PlatformError> => {
          const name = typeof filename === "string" ? filename : filename.toString();
          const eventPath = Path.isAbsolute(name) ? name : Path.join(path, name);
          switch (eventType) {
            case "rename":
              return stat(eventPath).pipe(
                Effect.match({
                  onFailure: () => ({ _tag: "Remove", path: eventPath }),
                  onSuccess: () => ({ _tag: "Create", path: eventPath }),
                }),
              );
            default:
              return Effect.succeed({ _tag: "Update", path: eventPath });
          }
        },
      ),
    );

  const watch: FileSystem.FileSystem["watch"] = (path) =>
    pipe(
      stat(path),
      Effect.map((info) =>
        pipe(
          watchBackend,
          Option.flatMap((_) => _.register(path, info)),
          Option.getOrElse(() => watchMemfs(path)),
        ),
      ),
      Stream.unwrap,
    );

  return FileSystem.make({
    access: (path, options) => {
      let mode = constants.F_OK;
      if (options?.readable) {
        mode |= constants.R_OK;
      }
      if (options?.writable) {
        mode |= constants.W_OK;
      }
      return tryOp("access", path, () => promises.access(path, mode));
    },
    chmod: (path, mode) => tryOp("chmod", path, () => promises.chmod(path, mode)),
    chown: (path, uid, gid) => tryOp("chown", path, () => promises.chown(path, uid, gid)),
    copy: (fromPath, toPath, options) =>
      tryOp("copy", fromPath, () =>
        promises.cp(fromPath, toPath, {
          recursive: true,
          force: options?.overwrite ?? false,
          preserveTimestamps: options?.preserveTimestamps ?? false,
        }),
      ),
    copyFile: (fromPath, toPath) =>
      tryOp("copyFile", fromPath, () => promises.copyFile(fromPath, toPath)),
    glob: (pattern, options) =>
      tryOp("glob", pattern, () =>
        promises.glob(pattern, {
          cwd: options?.root,
          exclude: options?.exclude ? Array.from(options.exclude) : undefined,
        }),
      ),
    link: (existingPath, newPath) =>
      tryOp("link", existingPath, () => promises.link(existingPath, newPath)),
    makeDirectory: (path, options) =>
      tryOp("makeDirectory", path, () =>
        promises.mkdir(path, { recursive: options?.recursive ?? false, mode: options?.mode }),
      ),
    makeTempDirectory,
    makeTempDirectoryScoped,
    makeTempFile,
    makeTempFileScoped,
    open,
    readDirectory: (path, options) =>
      pipe(
        tryOp("readDirectory", path, () =>
          promises.readdir(path, { recursive: options?.recursive ?? false }),
        ),
        Effect.map((entries) =>
          entries.map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }
            if ("name" in entry) {
              return String(entry.name);
            }
            return entry.toString();
          }),
        ),
      ),
    readFile,
    readLink: (path) =>
      pipe(
        tryOp("readLink", path, () => promises.readlink(path)),
        Effect.map(toString),
      ),
    realPath: (path) =>
      pipe(
        tryOp("realPath", path, () => promises.realpath(path)),
        Effect.map(toString),
      ),
    remove: removeFactory("remove"),
    rename: (oldPath, newPath) => tryOp("rename", oldPath, () => promises.rename(oldPath, newPath)),
    stat,
    symlink: (target, path) => tryOp("symlink", path, () => promises.symlink(target, path)),
    truncate: (path, length) =>
      tryOp("truncate", path, () =>
        promises.truncate(path, length !== undefined ? Number(length) : undefined),
      ),
    utimes: (path, atime, mtime) =>
      tryOp("utimes", path, () => promises.utimes(path, atime, mtime)),
    watch,
    writeFile,
  });
};

const FileSystemImpl = Layer.effect(FileSystem.FileSystem)(
  Effect.gen(function* () {
    const { fs } = yield* MemFs;
    const backend = yield* Effect.serviceOption(FileSystem.WatchBackend);
    return make(fs, backend);
  }),
);

/**
 * Provides the `FileSystem.FileSystem` service backed by a fresh, empty
 * in-memory `memfs` volume.
 *
 * The layer is fresh, so every `Effect.provide` boundary builds a new,
 * isolated volume. Wrap in `Effect.scoped` to tie the volume's lifetime to a
 * scope.
 *
 * @category layers
 */
export const layer: Layer.Layer<FileSystem.FileSystem | MemFs> = Layer.fresh(
  Layer.provideMerge(FileSystemImpl, MemFs.layer),
);

/**
 * Provides the `FileSystem.FileSystem` service backed by a fresh in-memory
 * `memfs` volume seeded with a JSON directory structure.
 *
 * @example
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem;
 *   yield* fs.readFileString("/workspace/README.md");
 * }).pipe(Effect.provide(Fs.layerWith({ "/workspace": { "README.md": "# hello" } })));
 *
 * @category layers
 */
export const layerWith = (
  json?: NestedDirectoryJSON,
  options?: MemfsOptions,
): Layer.Layer<FileSystem.FileSystem | MemFs> =>
  Layer.fresh(Layer.provideMerge(FileSystemImpl, MemFs.layerWith(json, options)));
