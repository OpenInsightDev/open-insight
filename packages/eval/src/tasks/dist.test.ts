import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { gzipSync, zstdCompressSync } from "node:zlib";
import * as tar from "tar-stream";
import { withDist } from "./dist.ts";

const makeTar = Effect.fn(function* () {
  const pack = yield* Effect.sync(() => tar.pack());
  yield* Effect.sync(() => {
    pack.entry({ name: "nested/fixture.txt" }, "fixture contents");
    pack.finalize();
  });
  const chunks = yield* Effect.tryPromise(() => Array.fromAsync(pack));
  return Buffer.concat(chunks);
});

describe("withDist", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("streams and extracts supported archives before loading tasks", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tarball = yield* makeTar();
        const archives: ReadonlyArray<{
          readonly format: "tar.gz" | "tar.zst";
          readonly bytes: Uint8Array;
        }> = [
          { format: "tar.gz", bytes: gzipSync(tarball) },
          { format: "tar.zst", bytes: zstdCompressSync(tarball) },
        ];

        yield* Effect.forEach(archives, ({ bytes, format }) => {
          const url = `https://example.test/${process.pid}-${Date.now()}.${format}`;
          const client = HttpClient.make((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, new Response(bytes))),
          );

          return withDist({ url, format })(({ distPath }) =>
            fs.readFileString(path.join(distPath, "nested", "fixture.txt")).pipe(
              Effect.tap((contents) =>
                Effect.sync(() => assert.strictEqual(contents, "fixture contents")),
              ),
              Effect.as([]),
            ),
          ).pipe(
            Effect.provideService(HttpClient.HttpClient, client),
            Effect.tap((tasks) => Effect.sync(() => assert.deepStrictEqual(tasks, []))),
          );
        });
      }),
    );
  });
});
