import { NodeCrypto, NodeFileSystem, NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref, Sink, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Resource from "#/resource/export.ts";
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

const resources = Resource.Resources.make({
  numCPUs: 0.5,
  numGPUs: 0,
  memoryMiB: 64,
  storageMiB: 64,
  network: Resource.Network.noNetwork(),
  buildTimeoutSec: 120,
  runTimeoutSec: 120,
});

const networkedResources = Resource.Resources.make({
  numCPUs: 0.5,
  numGPUs: 0,
  memoryMiB: 64,
  storageMiB: 64,
  network: Resource.Network.publicAccess(),
  buildTimeoutSec: 120,
  runTimeoutSec: 120,
});

const dockerCommand = (args: ReadonlyArray<string>) => CP.make("docker", args);

const dockerExitCode = Effect.fn(function* (args: ReadonlyArray<string>) {
  const spawner = yield* Spawn.Service;
  const result = yield* spawner.exec(dockerCommand(args), { errorOnNonZeroExit: false });
  return result.exitCode;
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

const assertDockerObjectMissing = Effect.fn(function* (kind: "container" | "image", name: string) {
  const exitCode = yield* dockerExitCode([kind, "inspect", name]);
  assert.notStrictEqual(exitCode, 0);
});

const makeHandle = (
  stdout: string,
  exitCode: Effect.Effect<ChildProcessSpawner.ExitCode>,
): ChildProcessSpawner.ChildProcessHandle => {
  const output = stdout.length === 0 ? Stream.empty : Stream.make(new TextEncoder().encode(stdout));

  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: output,
    stderr: Stream.empty,
    all: output,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

it.effect("acquires startup before removing an interrupted container", () =>
  Effect.gen(function* () {
    const exists = yield* Ref.make(false);
    const started = yield* Deferred.make<void>();
    const finishStartup = yield* Deferred.make<void>();
    const created = yield* Deferred.make<void>();
    const exitCode = ChildProcessSpawner.ExitCode(0);

    const childProcessSpawner = ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand") {
        return Effect.die("Unexpected piped command");
      }

      const [operation, ...args] = command.args;
      if (command.command === "command" && operation === "-v") {
        return Effect.succeed(
          makeHandle(
            args[0] === "docker" ? "/usr/bin/docker\n" : "",
            Effect.succeed(ChildProcessSpawner.ExitCode(args[0] === "docker" ? 0 : 1)),
          ),
        );
      }
      if (command.command === "/usr/bin/docker" && operation === "run") {
        return Effect.succeed(
          makeHandle(
            "",
            Deferred.succeed(started, void 0).pipe(
              Effect.andThen(Deferred.await(finishStartup)),
              Effect.andThen(Ref.set(exists, true)),
              Effect.andThen(Deferred.succeed(created, void 0)),
              Effect.as(exitCode),
            ),
          ),
        );
      }
      if (command.command === "/usr/bin/docker" && operation === "rm") {
        return Effect.succeed(makeHandle("", Ref.set(exists, false).pipe(Effect.as(exitCode))));
      }

      return Effect.die(`Unexpected command: ${command.command} ${command.args.join(" ")}`);
    });

    const provider = yield* Docker.make({}).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.provide([NodeCrypto.layer, NodeFileSystem.layer]),
    );
    const handle = yield* Snapshot.Handle.make(Snapshot.make({ image: "busybox:latest" })).pipe(
      Effect.provide(NodeCrypto.layer),
    );

    const fiber = yield* provider
      .runSandbox({ handle, resources: Resource.Resources.make({}) })
      .pipe(Effect.scoped, Effect.forkChild);

    yield* Deferred.await(started);
    assert.isFalse(yield* Ref.get(exists));

    const interruption = yield* Fiber.interrupt(fiber).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    assert.isUndefined(interruption.pollUnsafe());

    yield* Deferred.succeed(finishStartup, void 0);
    yield* Deferred.await(created);
    yield* Fiber.join(interruption);
    assert.isFalse(yield* Ref.get(exists));
  }),
);

it.effect("removes a container when startup exits with a defect", () =>
  Effect.gen(function* () {
    const exists = yield* Ref.make(false);
    const exitCode = ChildProcessSpawner.ExitCode(0);

    const childProcessSpawner = ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand") {
        return Effect.die("Unexpected piped command");
      }

      const [operation, ...args] = command.args;
      if (command.command === "command" && operation === "-v") {
        return Effect.succeed(
          makeHandle(
            args[0] === "docker" ? "/usr/bin/docker\n" : "",
            Effect.succeed(ChildProcessSpawner.ExitCode(args[0] === "docker" ? 0 : 1)),
          ),
        );
      }
      if (command.command === "/usr/bin/docker" && operation === "run") {
        return Effect.succeed(
          makeHandle(
            "",
            Ref.set(exists, true).pipe(Effect.andThen(Effect.die("Docker startup output failed"))),
          ),
        );
      }
      if (command.command === "/usr/bin/docker" && operation === "rm") {
        return Effect.succeed(makeHandle("", Ref.set(exists, false).pipe(Effect.as(exitCode))));
      }

      return Effect.die(`Unexpected command: ${command.command} ${command.args.join(" ")}`);
    });

    const provider = yield* Docker.make({}).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
      Effect.provide([NodeCrypto.layer, NodeFileSystem.layer]),
    );
    const handle = yield* Snapshot.Handle.make(Snapshot.make({ image: "busybox:latest" })).pipe(
      Effect.provide(NodeCrypto.layer),
    );

    yield* provider
      .runSandbox({ handle, resources: Resource.Resources.make({}) })
      .pipe(Effect.scoped, Effect.exit);

    assert.isFalse(yield* Ref.get(exists));
  }),
);

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
              const sandbox = yield* provider.runSandbox({
                handle: derived,
                resources: networkedResources,
              });
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

              const nonZero = yield* sandbox.spawn(
                { command: "sh", args: ["-c", "printf out; printf err >&2; exit 7"] },
                { errorOnNonZeroExit: false },
              );
              assert.strictEqual(nonZero.exitCode, 7);
              assert.strictEqual(nonZero.stdout, "out");
              assert.strictEqual(nonZero.stderr, "err");
              assert.strictEqual(
                yield* sandbox.exitCode({ command: "sh", args: ["-c", "exit 6"] }),
                6,
              );

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
              const [nanoCPUs, memoryBytes, networkMode, storageSize] = resourceConfig
                .trim()
                .split("|");
              assert.strictEqual(nanoCPUs, "500000000");
              assert.strictEqual(memoryBytes, "67108864");
              assert.notStrictEqual(networkMode, "none");
              assert.strictEqual(storageSize, "64m");

              yield* sandbox.writeFile({
                sandboxPath: "/www/index.html",
                content: "docker sandbox response",
              });
              yield* sandbox.cmd({
                command: "httpd",
                args: ["-p", "8080", "-h", "/www"],
              });
              const { hostUrl } = yield* sandbox.expose({ sandboxPort: 8080 });
              const response = yield* Effect.tryPromise(() =>
                fetch(hostUrl).then((res) => res.text()),
              );
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
                (yield* dockerString([
                  "inspect",
                  "--format",
                  "{{.HostConfig.NetworkMode}}",
                  containerName,
                ])).trim(),
                "none",
              );

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
          const handle = yield* Effect.scoped(provider.aquireSnapshot({ snapshot, cache: true }));

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
