import { ChildProcess } from "effect/unstable/process";
import { Crypto, Effect, Encoding, FileSystem, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Spawn } from "@open-insight/core/utils";
import * as Task from "../index.ts";
import type { Loader } from "./index.ts";

const archiveHash = Effect.fn(function* (url: string) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(url);
  const digest = yield* crypto.digest("SHA-256", bytes);
  return Encoding.encodeHex(digest);
});

export const withDist = ({ url, format = "tar.gz" }: { url: string; format?: "tar.gz" }) =>
  Effect.fn(function* <T extends Task.Task>(exec: (options: { distPath: string }) => Loader<T>) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.SpawnService;

    const hash = yield* archiveHash(url);
    const distPath = yield* fs.makeTempDirectory({
      prefix: `open-insight-dist-${hash}`,
    });

    const cacheHit = yield* fs.exists(distPath);
    if (!cacheHit) {
      const archivePath = yield* fs.makeTempFile({
        suffix: `.${format}`,
      });
      const parsedUrl = yield* Schema.decodeUnknownEffect(Schema.URLFromString)(url);
      const bytes = yield* HttpClient.get(parsedUrl).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.map((buffer) => new Uint8Array(buffer)),
      );
      yield* fs.writeFile(archivePath, bytes);

      yield* fs.makeDirectory(distPath, { recursive: true });
      const extract = ChildProcess.make`tar -xzf ${archivePath} -C ${distPath}`;
      yield* spawner.exitCode(extract);
    }

    return yield* exec({ distPath });
  });
