import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as tar from "tar";
import { withDist } from "./dist.ts";

const makeArchive = Effect.fn(function* (format: "tar.gz" | "tar.zst") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  const source = path.join(root, "source");
  const archive = path.join(root, `fixture.${format}`);
  yield* fs.makeDirectory(path.join(source, "nested"), { recursive: true });
  yield* fs.writeFileString(path.join(source, "nested", "fixture.txt"), "fixture contents");
  yield* Effect.tryPromise({
    try: () =>
      tar.create(
        {
          cwd: source,
          file: archive,
          gzip: format === "tar.gz",
          zstd: format === "tar.zst",
        },
        ["nested"],
      ),
    catch: (cause) => new globalThis.Error("Failed to create test archive", { cause }),
  });
  return yield* fs.readFile(archive);
});

describe("withDist", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("downloads and extracts supported archives before loading tasks", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const formats: ReadonlyArray<"tar.gz" | "tar.zst"> = ["tar.gz", "tar.zst"];

        yield* Effect.forEach(formats, (format) =>
          Effect.gen(function* () {
            const bytes = yield* makeArchive(format);
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
          }),
        );
      }),
    );
  });
});
