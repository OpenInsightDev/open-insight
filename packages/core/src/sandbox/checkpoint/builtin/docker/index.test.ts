import { assert, describe, it } from "@effect/vitest";
import { Spawn } from "@open-insight/utils";
import * as NodePlatform from "@effect/platform-node";
import { Context, Effect, Layer, Sink, Stream } from "effect";
import { systemError } from "effect/PlatformError";
import { ChildProcess as CP } from "effect/unstable/process";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type { Sandbox } from "../../../sandbox/index.ts";
import { make as makeCheckpoint } from "./index.ts";

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

const makeSpawner = (records: Array<RecordedCommand>): Spawner => {
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

      // The runtime prefix prepends "docker", so a "commit" subcommand becomes
      // "docker commit <id>".
      if (
        current.command === "docker" &&
        current.args[0] === "commit" &&
        current.args[1] !== undefined
      ) {
        return makeHandle("sha256:checkpoint-test-image");
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

const makeLayer = (records: Array<RecordedCommand>) =>
  Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, makeSpawner(records)),
    NodePlatform.NodeCrypto.layer,
    Spawn.SpawnService.layer.pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, makeSpawner(records))),
    ),
  );

const commandKey = (record: RecordedCommand) => [record.command, ...record.args].join(" ");

const makeMockSandbox = (hostname: string): Sandbox => ({
  $: () => Effect.succeed(hostname),
  readFile: () => Effect.succeed(""),
  writeFile: () => Effect.void,
  download: () => Effect.void,
  upload: () => Effect.void,
  expose: () => Effect.succeed({ hostUrl: "http://localhost:8000" }),
});

describe("docker checkpoint", () => {
  it.effect("creates the checkpoint provider from node services", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const checkpoint = yield* makeCheckpoint({});
      assert.isTrue(typeof checkpoint.commit === "function");
      assert.isTrue(records.some((record) => commandKey(record) === "command -v docker"));
    }).pipe(Effect.provide(makeLayer(records)));
  });

  it.effect("commit captures the sandbox state as a new snapshot", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const checkpoint = yield* makeCheckpoint({});
      const sandbox = makeMockSandbox("container-abc");

      const snapshot = yield* checkpoint.commit({ sandbox });

      // Snapshot should have no instructions — it's a runtime capture.
      assert.strictEqual(snapshot.instructions.length, 0);
      assert.strictEqual(snapshot.image, "sha256:checkpoint-test-image");

      // The runtime prefix produces "docker commit <id>".
      assert.isTrue(records.some((record) => commandKey(record) === "docker commit container-abc"));

      // The runtime prefix produces "docker tag <id> <name>".
      const tagRecord = records.find(
        (record) =>
          record.command === "docker" &&
          record.args[0] === "tag" &&
          record.args[1] === "sha256:checkpoint-test-image",
      );
      assert.isDefined(tagRecord);
      if (tagRecord) {
        assert.isTrue(tagRecord.args[2]?.startsWith("open-insight-snapshot:"));
      }
    }).pipe(Effect.provide(makeLayer(records)));
  });

  it.effect("commit fails when hostname is empty", () => {
    const records: Array<RecordedCommand> = [];
    return Effect.gen(function* () {
      const checkpoint = yield* makeCheckpoint({});
      const sandbox = makeMockSandbox("");

      const result = yield* checkpoint.commit({ sandbox }).pipe(Effect.flip);

      assert.strictEqual(result.reason._tag, "ProviderError");
      assert.strictEqual(result.reason.name, "docker");
    }).pipe(Effect.provide(makeLayer(records)));
  });
});
