import { Crypto, Effect, Encoding, FileSystem, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as Task from "#/task/index.ts";
import { Error } from "./error.ts";
import type { Load } from "./index.ts";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createZstdDecompress } from "node:zlib";
import * as tar from "tar-stream";

const archiveHash = Effect.fn(function* (url: string) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(url);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

const archiveEntryPath = (root: string, entryName: string) => {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, entryName);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new globalThis.Error(`Archive entry escapes extraction directory: ${entryName}`);
  }
  return target;
};

const extractArchive = async (
  archivePath: string,
  distPath: string,
  format: "tar.gz" | "tar.zst",
) => {
  const extract = tar.extract();
  const decompressor = format === "tar.zst" ? createZstdDecompress() : createGunzip();
  const extraction = pipeline(createReadStream(archivePath), decompressor, extract);

  for await (const entry of extract) {
    const target = archiveEntryPath(distPath, entry.header.name);
    if (entry.header.type === "directory") {
      await mkdir(target, { recursive: true });
      entry.resume();
      continue;
    }

    if (
      entry.header.type === undefined ||
      entry.header.type === null ||
      entry.header.type === "file"
    ) {
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(entry, createWriteStream(target));
      continue;
    }

    entry.resume();
  }

  await extraction;
};

export const withDist = ({
  url,
  format = "tar.gz",
}: {
  url: string;
  format?: "tar.gz" | "tar.zst";
}) =>
  Effect.fn(function* <T extends Task.Task, E, R>(
    exec: (options: { distPath: string }) => Load<T, E, R>,
  ) {
    const fs = yield* FileSystem.FileSystem;

    const hash = yield* archiveHash(url);
    const distPath = path.join(os.tmpdir(), `open-insight-dist-${hash}`);
    const readyPath = path.join(distPath, ".complete");
    const cacheHit = yield* fs.exists(readyPath);

    if (!cacheHit) {
      yield* fs.remove(distPath, { recursive: true, force: true });
      yield* fs.makeDirectory(distPath, { recursive: true });

      const archivePath = yield* fs.makeTempFile({
        suffix: `.${format}`,
      });
      yield* Effect.gen(function* () {
        const parsedUrl = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(url);
        const bytes = yield* HttpClient.get(parsedUrl).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(({ arrayBuffer }) => arrayBuffer),
          Effect.map((buffer) => new Uint8Array(buffer)),
        );
        yield* fs.writeFile(archivePath, bytes);

        yield* Effect.tryPromise({
          try: () => extractArchive(archivePath, distPath, format),
          catch: Error.source,
        });
        yield* fs.writeFileString(readyPath, url);
      }).pipe(Effect.ensuring(fs.remove(archivePath, { force: true }).pipe(Effect.ignore)));
    }

    const loader = yield* Effect.try({
      try: () => exec({ distPath }),
      catch: Error.init,
    });
    return yield* loader;
  }, Effect.mapError(Error.source));
