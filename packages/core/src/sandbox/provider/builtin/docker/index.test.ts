import { assert, describe, it } from "@effect/vitest";
import { Spawn } from "@open-insight/utils";
import * as NodePlatform from "@effect/platform-node";
import { Context, Effect, Layer, Sink, Stream } from "effect";
import { systemError } from "effect/PlatformError";
import { ChildProcess as CP } from "effect/unstable/process";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ContextDir from "../../../../sandbox/context/index.ts";
import * as Snapshot from "../../../../sandbox/snapshot/index.ts";
import { make as makeProvider } from "./index.ts";

type RecordedCommand = Readonly<{
  command: string;
  args: ReadonlyArray<string>;
  stdin: string | undefined;
}>;

type Spawner = Context.Service.Shape<typeof ChildProcessSpawner.ChildProcessSpawner>;

const encoder = new TextEncoder();

const makeHandle = (stdout: string) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.fromIterable([encoder.encode(stdout)]),
    stderr: Stream.empty,
    all: Stream.fromIterable([encoder.encode(stdout)]),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

const makeSpawnError = (message: string) =>
  systemError({
    _tag: "NotFound",
    module: "test",
    method: "spawn",
    description: message,
  });

const makeSpawner = (records: Array<RecordedCommand>, inspectSucceeds: boolean): Spawner => {
  const spawn: Spawner["spawn"] = (command) =>
    Effect.gen(function* () {
      let current = command;
      while (current._tag === "PipedCommand") {
        current = current.left;
      }

      if (!CP.isStandardCommand(current)) {
        return yield* Effect.fail(makeSpawnError("unsupported command"));
      }

      records.push({
        command: current.command,
        args: Array.from(current.args),
        stdin: undefined,
      });

      const key = [current.command, ...current.args].join(" ");
      if (key === "command -v docker") {
        return makeHandle("docker");
      }
      if (key === "command -v podman" || key === "command -v nerdctl") {
        return yield* Effect.fail(makeSpawnError(`missing ${current.args.at(-1) ?? "runtime"}`));
      }
      if (
        current.command === "docker" &&
        current.args[0] === "image" &&
        current.args[1] === "inspect"
      ) {
        if (inspectSucceeds) {
          return makeHandle("");
        }
        return yield* Effect.fail(makeSpawnError(`missing image: ${current.args[2] ?? ""}`));
      }
      if (current.command === "docker" && current.args[0] === "exec") {
        const shell = current.args.at(-1) ?? "";
        if (shell.includes("'printenv'")) {
          return makeHandle("hello");
        }
        if (shell.includes("'cat'")) {
          return makeHandle("sandbox-file");
        }
      }

      return makeHandle("");
    });

  return ChildProcessSpawner.ChildProcessSpawner.of({
    spawn: (command) => Effect.scoped(spawn(command)),
    exitCode: (command) =>
      Effect.scoped(spawn(command)).pipe(Effect.flatMap((handle) => handle.exitCode)),
    streamString: (command, options) =>
      spawn(command).pipe(
        Effect.map((handle) =>
          Stream.decodeText(options?.includeStderr === true ? handle.all : handle.stdout),
        ),
        Stream.unwrap,
      ),
    streamLines: (command, options) =>
      Stream.splitLines(
        spawn(command).pipe(
          Effect.map((handle) =>
            Stream.decodeText(options?.includeStderr === true ? handle.all : handle.stdout),
          ),
          Stream.unwrap,
        ),
      ),
    lines: (command, options) =>
      Stream.runCollect(
        Stream.splitLines(
          spawn(command).pipe(
            Effect.map((handle) =>
              Stream.decodeText(options?.includeStderr === true ? handle.all : handle.stdout),
            ),
            Stream.unwrap,
          ),
        ),
      ),
    string: (command, options) =>
      Stream.mkString(
        spawn(command).pipe(
          Effect.map((handle) =>
            Stream.decodeText(options?.includeStderr === true ? handle.all : handle.stdout),
          ),
          Stream.unwrap,
        ),
      ),
  });
};

const makeLayer = (records: Array<RecordedCommand>, inspectSucceeds: boolean) =>
  Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, makeSpawner(records, inspectSucceeds)),
    NodePlatform.NodeCrypto.layer,
    NodePlatform.NodeFileSystem.layer,
    NodePlatform.NodePath.layer,
    NodePlatform.NodeHttpClient.layerNodeHttp,
    Spawn.SpawnService.layer.pipe(
      Layer.provide(
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          makeSpawner(records, inspectSucceeds),
        ),
      ),
    ),
  );

const commandKey = (record: RecordedCommand) => [record.command, ...record.args].join(" ");

describe("docker provider", () => {
  it.effect("creates the provider from node services", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({});
      assert.isTrue(typeof provider.ensureSnapshot === "function");
      assert.isTrue(records.some((record) => commandKey(record) === "command -v docker"));
    }).pipe(Effect.provide(makeLayer(records, false)));
  });

  it.effect("ensureSnapshot builds the image from the encoded containerfile", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const snapshot = Snapshot.Snapshot.make({
        image: "node:22-alpine",
        instructions: [Snapshot.Inst.run("echo ready")],
      });
      const snapshotName = yield* Snapshot.makeName(snapshot);

      yield* provider.ensureSnapshot({
        snapshot,
        context: yield* ContextDir.make("/workspace/context"),
      });

      const buildCommand = records.find(
        (record) => record.command === "docker" && record.args[0] === "build",
      );
      assert.isDefined(buildCommand);
      assert.isTrue(
        records.some((record) => commandKey(record) === `docker image inspect ${snapshotName}`),
      );
    }).pipe(Effect.provide(makeLayer(records, false)));
  });

  it.effect("ensureSnapshot skips the build when the image already exists", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const snapshot = Snapshot.Snapshot.make({ image: "node:22-alpine", instructions: [] });

      yield* provider.ensureSnapshot({
        snapshot,
        context: yield* ContextDir.make("/workspace/context"),
      });

      assert.isTrue(
        records.some((record) => commandKey(record).startsWith("docker image inspect ")),
      );
      assert.isTrue(
        records.every((record) => record.command !== "docker" || record.args[0] !== "build"),
      );
    }).pipe(Effect.provide(makeLayer(records, true)));
  });

  it.effect("deriveSnapshot ensures the base and derived images", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const baseSnapshot = Snapshot.Snapshot.make({
        image: "node:22-alpine",
        instructions: [Snapshot.Inst.workdir("/app")],
      });
      const instructions = [Snapshot.Inst.run("pnpm test")];
      const derivedSnapshot = Snapshot.Snapshot.make({
        image: yield* Snapshot.makeName(baseSnapshot),
        instructions,
      });

      const baseName = yield* Snapshot.makeName(baseSnapshot);
      const derivedName = yield* Snapshot.makeName(derivedSnapshot);
      yield* provider.deriveSnapshot({
        snapshot: baseSnapshot,
        context: yield* ContextDir.make("/workspace/context"),
        instructions,
      });

      assert.isTrue(
        records.some((record) => commandKey(record) === `docker image inspect ${baseName}`),
      );
      assert.isTrue(
        records.some((record) => commandKey(record) === `docker image inspect ${derivedName}`),
      );
    }).pipe(Effect.provide(makeLayer(records, false)));
  });

  it.effect("removeSnapshot removes the tagged image", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const snapshot = Snapshot.Snapshot.make({ image: "node:22-alpine", instructions: [] });
      const snapshotName = yield* Snapshot.makeName(snapshot);

      yield* provider.removeSnapshot({ snapshot });

      assert.isTrue(records.some((record) => commandKey(record) === `docker rmi ${snapshotName}`));
    }).pipe(Effect.provide(makeLayer(records, false)));
  });

  it.effect("runSandbox wires exec, file transfer, expose and cleanup", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const provider = yield* makeProvider({
        portMappings: [{ sandboxPort: 8080, hostPort: 18080 }],
      });
      const snapshot = Snapshot.Snapshot.make({ image: "node:22-alpine", instructions: [] });
      const snapshotName = yield* Snapshot.makeName(snapshot);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const sandbox = yield* provider.runSandbox({
            snapshot,
            resources: { numCPUs: 2, memoryMiB: 512, numGPUs: 1, diskMiB: 1024 },
          });

          const execOutput = yield* sandbox.$(
            CP.make("printenv", ["FOO"], { env: { FOO: "bar" }, cwd: "/work" }),
          );
          const readOutput = yield* sandbox.readFile({ sandboxPath: "/tmp/file.txt" });
          yield* sandbox.writeFile({ sandboxPath: "/tmp/out.txt", content: "payload" });
          yield* sandbox.download({ sandboxPath: "/tmp/file.txt", hostPath: "/tmp/host-file.txt" });
          yield* sandbox.upload({
            sandboxPath: "/tmp/upload.txt",
            hostPath: "/tmp/host-upload.txt",
          });
          const exposed = yield* sandbox.expose({ sandboxPort: 8080, hostPort: 18080 });

          assert.strictEqual(execOutput, "hello");
          assert.strictEqual(readOutput, "sandbox-file");
          assert.strictEqual(exposed.hostUrl, "http://localhost:18080");
        }),
      );

      const runCommand = records.find(
        (record) => record.command === "docker" && record.args[0] === "run",
      );
      assert.isDefined(runCommand);
      assert.isTrue(
        records.some((record) => record.command === "docker" && record.args[0] === "exec"),
      );
      assert.isTrue(
        records.some((record) => record.command === "docker" && record.args[0] === "cp"),
      );
      assert.isTrue(
        records.some((record) => record.command === "docker" && record.args[0] === "rm"),
      );
      if (runCommand !== undefined) {
        assert.isTrue(runCommand.args.includes(snapshotName));
      }
    }).pipe(Effect.provide(makeLayer(records, false)));
  });
});
