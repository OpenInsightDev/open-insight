import { Effect, FileSystem, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { SandboxError } from "../error.ts";
import { type Context, type Mode } from "./schema.ts";

const decodeUrl = Schema.decodeUnknownEffect(Schema.URLFromString);

const extractTarGz = Effect.fn(function* (archivePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner;
  const dir = yield* fs.makeTempDirectory({
    prefix: "open-insight-dist-",
  });

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("tar", ["-xzf", archivePath, "-C", dir]),
  );

  if (exitCode !== 0) {
    return yield* Effect.fail(new Error(`tar exited with code ${exitCode}`));
  }

  return dir;
});

const resolveDistContext = Effect.fn(function* ({
  url,
  fileType,
}: Extract<Mode, { _tag: "Dist" }>) {
  const fs = yield* FileSystem.FileSystem;
  const parsedUrl = yield* decodeUrl(url);
  const archivePath = yield* fs.makeTempFile({
    prefix: "open-insight-dist-",
    suffix: fileType,
  });

  const bytes = yield* HttpClient.get(parsedUrl).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.map((buffer) => new Uint8Array(buffer)),
  );
  yield* fs.writeFile(archivePath, bytes);

  if (fileType === ".tar.gz") {
    return yield* extractTarGz(archivePath);
  }

  return yield* Effect.fail(new Error(`Unsupported dist file type: ${String(fileType)}`));
});

export const resolveDist = Effect.fn(function* (
  mode: Extract<Mode, { _tag: "Dist" }>,
): Effect.fn.Return<
  Context,
  SandboxError,
  ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
> {
  return yield* resolveDistContext(mode).pipe(Effect.mapError(SandboxError.contextResolve(mode)));
});
