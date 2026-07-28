import { ChildProcess } from "effect/unstable/process";
import { Crypto, Effect, Encoding, FileSystem, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Spawn } from "@open-insight/core/utils";
import * as Task from "#/task/index.ts";
import { Error } from "./error.ts";
import type { Load } from "./index.ts";
import * as os from "node:os";
import * as path from "node:path";

const archiveHash = Effect.fn(function* (url: string) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(url);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

export const withDist = ({ url, format = "tar.gz" }: { url: string; format?: "tar.gz" }) =>
  Effect.fn(function* <T extends Task.Task, E, R>(
    exec: (options: { distPath: string }) => Load<T, E, R>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.Service;

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

        const extract = ChildProcess.make`tar -xzf ${archivePath} -C ${distPath}`;
        yield* spawner.success(extract);
        yield* fs.writeFileString(readyPath, url);
      }).pipe(Effect.ensuring(fs.remove(archivePath, { force: true }).pipe(Effect.ignore)));
    }

    const loader = yield* Effect.try({
      try: () => exec({ distPath }),
      catch: Error.init,
    });
    return yield* loader;
  }, Effect.mapError(Error.source));
