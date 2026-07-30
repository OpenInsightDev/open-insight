import { NodeCrypto, NodeFileSystem } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Effect, Ref, Sink, Stream } from "effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Resource from "#/resource/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn } from "#/utils/export.ts";
import { runSandbox } from "./sandbox.ts";
import { parseContainerHost } from "./utils.ts";

const resources = Resource.Resources.make({});
const isolatedResources = Resource.Resources.make({ network: Resource.Network.noNetwork() });

const inspectOutput = (address: string) =>
  JSON.stringify([
    {
      status: "running",
      networks: [
        {
          address,
          gateway: "192.168.64.1",
          hostname: "sandbox.test.",
          network: "default",
        },
      ],
    },
  ]);

it.effect(
  "extracts URL hosts from Apple container inspect output",
  Effect.fn(function* () {
    assert.strictEqual(yield* parseContainerHost(inspectOutput("192.168.64.3/24")), "192.168.64.3");
    assert.strictEqual(
      yield* parseContainerHost(inspectOutput("fd00:1234::2/64")),
      "[fd00:1234::2]",
    );
  }),
);

it.effect(
  "rejects inspect output without a container network address",
  Effect.fn(function* () {
    const error = yield* parseContainerHost('[{"networks":[]}]').pipe(Effect.flip);
    assert.strictEqual(error._tag, "SchemaError");
  }),
);

const makeHandle = (
  stdout: string,
  exitCode: ChildProcessSpawner.ExitCode,
): ChildProcessSpawner.ChildProcessHandle => {
  const output = stdout.length === 0 ? Stream.empty : Stream.make(new TextEncoder().encode(stdout));

  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(exitCode),
    isRunning: Effect.succeed(false),
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

const makeSpawner = Effect.fn(function* (
  childProcessSpawner: ReturnType<typeof ChildProcessSpawner.make>,
) {
  return yield* Effect.service(Spawn.Service).pipe(
    Effect.provide(Spawn.Service.layer),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
  );
});

it.effect(
  "exposes the container IP directly without publishing ports",
  Effect.fn(function* () {
    const commands = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const exitCode = ChildProcessSpawner.ExitCode(0);
    const childProcessSpawner = ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand" || command.command !== "container") {
        return Effect.die("Unexpected command");
      }

      const output = command.args[0] === "inspect" ? inspectOutput("192.168.64.7/24") : "";
      return Ref.update(commands, (all) => [...all, command.args]).pipe(
        Effect.as(makeHandle(output, exitCode)),
      );
    });
    const spawner = yield* makeSpawner(childProcessSpawner);
    const handle = yield* Snapshot.Handle.make(Snapshot.make("busybox:latest")).pipe(
      Effect.provide(NodeCrypto.layer),
    );

    const hostUrl = yield* runSandbox({ handle, resources, timeout: "5 seconds" }).pipe(
      Effect.flatMap(
        Effect.fn(function* (sandbox) {
          return (yield* sandbox.expose({ sandboxPort: 8080 })).hostUrl;
        }),
      ),
      Effect.scoped,
      Effect.provideService(Spawn.Service, spawner),
      Effect.provide([NodeCrypto.layer, NodeFileSystem.layer]),
    );

    assert.strictEqual(hostUrl, "http://192.168.64.7:8080");

    const recorded = yield* Ref.get(commands);
    const create = recorded.find(([operation]) => operation === "create");
    const inspect = recorded.find(([operation]) => operation === "inspect");
    assert.isDefined(create);
    assert.isDefined(inspect);
    assert.notInclude(create, "--publish");
    assert.notInclude(create, "-p");
    assert.strictEqual(inspect[1], create[create.indexOf("--name") + 1]);
  }),
);

it.effect(
  "removes the container and network when startup fails",
  Effect.fn(function* () {
    const commands = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const childProcessSpawner = ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand" || command.command !== "container") {
        return Effect.die("Unexpected command");
      }

      const exitCode = ChildProcessSpawner.ExitCode(command.args[0] === "start" ? 1 : 0);
      return Ref.update(commands, (all) => [...all, command.args]).pipe(
        Effect.as(makeHandle("", exitCode)),
      );
    });
    const spawner = yield* makeSpawner(childProcessSpawner);
    const handle = yield* Snapshot.Handle.make(Snapshot.make("busybox:latest")).pipe(
      Effect.provide(NodeCrypto.layer),
    );

    yield* runSandbox({ handle, resources: isolatedResources, timeout: "5 seconds" }).pipe(
      Effect.scoped,
      Effect.provideService(Spawn.Service, spawner),
      Effect.provide([NodeCrypto.layer, NodeFileSystem.layer]),
      Effect.flip,
    );

    const recorded = yield* Ref.get(commands);
    const startIndex = recorded.findIndex(([operation]) => operation === "start");
    const containerDeleteIndex = recorded.findIndex(([operation]) => operation === "delete");
    const networkDeleteIndex = recorded.findIndex(
      ([operation, action]) => operation === "network" && action === "delete",
    );
    assert.isAtLeast(startIndex, 0);
    assert.isAbove(containerDeleteIndex, startIndex);
    assert.isAbove(networkDeleteIndex, containerDeleteIndex);
  }),
);
