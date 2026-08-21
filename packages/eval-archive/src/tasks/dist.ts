import { createHash } from "node:crypto";
import { Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Task from "#/task/index.ts";
import { TasksError } from "./error.ts";
import type { Load } from "./index.ts";
import * as tar from "tar";
import * as Cache from "./cache.ts";

const extractArchive = Effect.fn(function* (
  archivePath: string,
  distPath: string,
  format: "tar.gz" | "tar.zst",
) {
  yield* Effect.tryPromise({
    try: () =>
      tar.extract({
        cwd: distPath,
        file: archivePath,
        filter: (_, entry) =>
          entry instanceof tar.ReadEntry &&
          (entry.type === "File" ||
            entry.type === "OldFile" ||
            entry.type === "ContiguousFile" ||
            entry.type === "Directory"),
        gzip: format === "tar.gz",
        preservePaths: false,
        strict: true,
        unlink: true,
        zstd: format === "tar.zst",
      }),
    catch: TasksError.source,
  });
});

export const withDist = ({
  url,
  format = "tar.gz",
  cleanup = false,
}: {
  url: string;
  format?: "tar.gz" | "tar.zst";
  /** Whether to remove the cache directory after the tasks are loaded. Defaults to `false`. */
  cleanup?: boolean;
}) =>
  Effect.fn(function* <T extends Task.AnyTask, E, R>(
    exec: (options: { distPath: string }) => Load<T, E, R>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
    const distPath = yield* Cache.cacheDir(path.join("dist", key));
    if (cleanup) {
      yield* Effect.addFinalizer(() =>
        fs.remove(distPath, { recursive: true, force: true }).pipe(Effect.ignore),
      );
    }
    const archivePath = path.join(distPath, `.archive.${format}`);
    const parsedUrl = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(url);
    const archive = yield* HttpClient.get(parsedUrl).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError(TasksError.source),
    );
    yield* fs.writeFile(archivePath, archive);

    yield* extractArchive(archivePath, distPath, format);
    yield* fs.remove(archivePath, { force: true });

    const loader = yield* Effect.try({
      try: () => exec({ distPath }),
      catch: TasksError.init,
    });
    return yield* loader;
  }, Effect.mapError(TasksError.source));
