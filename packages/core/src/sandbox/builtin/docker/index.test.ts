import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn } from "#/utils/export.ts";
import * as Docker from "./index.ts";

const dockerAvailable = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const testLayer = Layer.merge(
  NodeServices.layer,
  Spawn.Service.layer.pipe(Layer.provide(NodeServices.layer)),
);

const resources = Sandbox.Resources.make({
  numCPUs: 0.5,
  numGPUs: 0,
  memoryMiB: 64,
  storageMiB: 64,
  network: false,
  buildTimeoutSec: 120,
  runTimeoutSec: 120,
});

const dockerCommand = (args: ReadonlyArray<string>) => CP.make("docker", args);

const dockerExitCode = Effect.fn(function* (args: ReadonlyArray<string>) {
  const spawner = yield* Spawn.Service;
  return yield* spawner.exitCode(dockerCommand(args));
});

const dockerString = Effect.fn(function* (args: ReadonlyArray<string>) {
  const spawner = yield* Spawn.Service;
  return yield* spawner.string(dockerCommand(args));
});

const containerNameForImage = Effect.fn(function* (image: string) {
  const output = yield* dockerString([
    "ps",
    "--filter",
    `ancestor=${image}`,
    "--format",
    "{{.Names}}",
  ]);
  const names = output
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  assert.lengthOf(names, 1);
  return names[0];
});

const assertDockerObjectMissing = Effect.fn(function* (
  kind: "container" | "image",
  name: string,
) {
  const exitCode = yield* dockerExitCode([kind, "inspect", name]);
  assert.notStrictEqual(exitCode, 0);
});

describe.skipIf(!dockerAvailable)("Docker sandbox end-to-end", () => {
  layer(testLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "builds and derives snapshots, runs commands, exposes ports, enforces resources, and cleans up",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const context = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(path.join(context, "fixture.txt"), "built from context\n");

          const snapshot = Snapshot.make({
            image: "busybox:latest",
            context,
            instructions: [
              Snapshot.copy(["fixture.txt"], "/opt/fixture.txt"),
              Snapshot.run("mkdir -p /workspace /www && cp /opt/fixture.txt /workspace/built.txt"),
              Snapshot.workdir("/workspace"),
              Snapshot.env({ SNAPSHOT_ENV: "snapshot value" }),
            ],
          });
          const provider = yield* Docker.make({
            portMappings: [{ sandboxPort: 8080 }],
          });

          const acquired = yield* Effect.scoped(
            Effect.gen(function* () {
              const base = yield* provider.aquireSnapshot({ snapshot });
              const derived = yield* provider.deriveSnapshot({
                handle: base,
                context,
                instructions: [
                  Snapshot.env({ DERIVED_ENV: "derived value" }),
                  Snapshot.run("printf derived > /workspace/derived.txt"),
                ],
              });
              const sandbox = yield* provider.runSandbox({ handle: derived, resources });
              const containerName = yield* containerNameForImage(derived.name);

              const command = yield* sandbox.spawn({
                command: "sh",
                args: [
                  "-c",
                  'printf "%s|%s|%s|%s|%s" "$PWD" "$SNAPSHOT_ENV" "$DERIVED_ENV" "$REQUEST_ENV" "$1"',
                  "sh",
                  "argument with spaces",
                ],
                cwd: "/workspace",
                env: { REQUEST_ENV: "request value" },
              });
              assert.strictEqual(
                command.stdout,
                "/workspace|snapshot value|derived value|request value|argument with spaces",
              );

              const nonZero = yield* sandbox
                .spawn(
                  { command: "sh", args: ["-c", "printf out; printf err >&2; exit 7"] },
                  { errorOnNonZeroExit: false },
                );
              assert.strictEqual(nonZero.exitCode, 7);
              assert.strictEqual(nonZero.stdout, "out");
              assert.strictEqual(nonZero.stderr, "err");

              const commandError = yield* sandbox
                .cmd({ command: "sh", args: ["-c", "exit 9"] })
                .pipe(Effect.flip);
              assert.strictEqual(commandError.reason._tag, "SandboxExecError");

              assert.strictEqual(
                yield* sandbox.readFile({ sandboxPath: "/workspace/built.txt" }),
                "built from context\n",
              );
              assert.strictEqual(
                yield* sandbox.readFile({ sandboxPath: "/workspace/derived.txt" }),
                "derived",
              );

              const resourceConfig = yield* dockerString([
                "inspect",
                "--format",
                '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.NetworkMode}}|{{index .HostConfig.StorageOpt "size"}}',
                containerName,
              ]);
              assert.strictEqual(resourceConfig.trim(), "500000000|67108864|none|64m");

              yield* sandbox.writeFile({
                sandboxPath: "/www/index.html",
                content: "docker sandbox response",
              });
              yield* sandbox.cmd({
                command: "httpd",
                args: ["-p", "8080", "-h", "/www"],
              });
              const { hostUrl } = yield* sandbox.expose({ sandboxPort: 8080 });
              const response = yield* Effect.tryPromise(() => fetch(hostUrl).then((res) => res.text()));
              assert.strictEqual(response, "docker sandbox response");

              const exposeError = yield* sandbox.expose({ sandboxPort: 9090 }).pipe(Effect.flip);
              assert.strictEqual(exposeError.reason._tag, "SandboxExposeError");

              return { base, containerName, derived };
            }),
          );

          yield* assertDockerObjectMissing("container", acquired.containerName);
          yield* assertDockerObjectMissing("image", acquired.derived.name);
          yield* assertDockerObjectMissing("image", acquired.base.name);
        }),
      180_000,
    );

    it.effect(
      "builds Containerfiles and transfers text and binary files",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const context = yield* fs.makeTempDirectoryScoped();
          const containerfilePath = path.join(context, "Containerfile");
          yield* fs.writeFileString(path.join(context, "seed.txt"), "containerfile seed\n");
          yield* fs.writeFileString(
            containerfilePath,
            [
              "FROM busybox:latest",
              "RUN mkdir -p /exchange /seed",
              "COPY seed.txt /seed/seed.txt",
              "",
            ].join("\n"),
          );

          const snapshot = yield* Snapshot.fromContainerfile({
            filePath: containerfilePath,
            context,
          });
          const provider = yield* Docker.make({});
          const hostUpload = path.join(context, "host upload.bin");
          const hostDownload = path.join(context, "host download.bin");
          const binary = new Uint8Array([0, 1, 2, 10, 13, 127, 128, 255]);
          yield* fs.writeFile(hostUpload, binary);

          const acquired = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* provider.aquireSnapshot({ snapshot });
              const sandbox = yield* provider.runSandbox({ handle, resources });
              const containerName = yield* containerNameForImage(handle.name);

              assert.strictEqual(
                yield* sandbox.readFile({ sandboxPath: "/seed/seed.txt" }),
                "containerfile seed\n",
              );

              const text = "text with spaces and a nul: \0 done\n";
              yield* sandbox.writeFile({
                sandboxPath: "/exchange/text file.txt",
                content: text,
              });
              assert.strictEqual(
                yield* sandbox.readFile({ sandboxPath: "/exchange/text file.txt" }),
                text,
              );

              yield* sandbox.upload({
                hostPath: hostUpload,
                sandboxPath: "/exchange/upload.bin",
              });
              yield* sandbox.download({
                sandboxPath: "/exchange/upload.bin",
                hostPath: hostDownload,
              });
              assert.deepStrictEqual(yield* fs.readFile(hostDownload), binary);

              const readError = yield* sandbox
                .readFile({ sandboxPath: "/missing.txt" })
                .pipe(Effect.flip);
              assert.strictEqual(readError.reason._tag, "SandboxExecError");

              return { containerName, handle };
            }),
          );

          yield* assertDockerObjectMissing("container", acquired.containerName);
          yield* assertDockerObjectMissing("image", acquired.handle.name);
        }),
      180_000,
    );

    it.effect(
      "keeps cached snapshots after their acquisition scope closes",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const context = yield* fs.makeTempDirectoryScoped();
          const snapshot = Snapshot.make({ image: "busybox:latest", context });
          const provider = yield* Docker.make({});
          const handle = yield* Effect.scoped(
            provider.aquireSnapshot({ snapshot, cache: true }),
          );

          yield* Effect.addFinalizer(() =>
            dockerExitCode(["image", "rm", "--force", handle.name]).pipe(Effect.ignore),
          );

          assert.strictEqual(yield* dockerExitCode(["image", "inspect", handle.name]), 0);
          const secondHandle = yield* Effect.scoped(
            provider.aquireSnapshot({ snapshot, cache: true }),
          );
          assert.deepStrictEqual(secondHandle, handle);
          assert.strictEqual(yield* dockerExitCode(["image", "inspect", handle.name]), 0);
        }),
      180_000,
    );
  });
});
