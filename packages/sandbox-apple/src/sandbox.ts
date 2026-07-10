import { Sandbox, Snapshot } from "@open-insight/core";
import { Bash, Spawn } from "@open-insight/core/utils";
import { Duration, Effect, FileSystem } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import type { Command } from "effect/unstable/process/ChildProcess";
import { makeSandboxSpawner } from "./spawn.ts";
import {
  containerOptions,
  findPortMapping,
  formatPortMappings,
  formatResources,
  minimumMemoryMiB,
  type PortMapping,
} from "./utils.ts";

type RunOptions = Readonly<{
  handle: Snapshot.Handle.Handle;
  portMappings: ReadonlyArray<PortMapping>;
  resources: Sandbox.Resources;
  timeout: Duration.Input;
}>;

const formatSandboxCommand = ({ command, args = [] }: Sandbox.Spawn.Command) =>
  [command, ...args].map(Bash.quote).join(" ");

const timedStart = (name: string, timeout: Duration.Input, command: Command) =>
  Effect.gen(function* () {
    const spawner = yield* Spawn.Service;
    yield* spawner.success(command);
  }).pipe(Effect.timeout(timeout), Effect.mapError(Sandbox.Error.sandboxStart(name)));

const ensureSupportedResources = (handle: Snapshot.Handle.Handle, resources: Sandbox.Resources) => {
  if (Sandbox.isUnlimited(resources.memoryMiB) || resources.memoryMiB >= minimumMemoryMiB) {
    return Effect.void;
  }

  return Effect.fail(
    Sandbox.Error.sandboxStart(handle.name)(
      new Error(
        `Apple container requires at least ${minimumMemoryMiB} MiB of memory, received ${resources.memoryMiB} MiB`,
      ),
    ),
  );
};

const createInternalNetwork = Effect.fn(function* ({
  name,
  networkName,
  timeout,
}: {
  name: string;
  networkName: string;
  timeout: Duration.Input;
}) {
  const spawner = yield* Spawn.Service;
  yield* timedStart(name, timeout, CP.make`container network create --internal ${networkName}`);
  yield* Effect.addFinalizer(() =>
    spawner.success(CP.make`container network delete ${networkName}`).pipe(
      Effect.tap(() =>
        Effect.logDebug("Removed Apple container sandbox network", {
          containerName: name,
          networkName,
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Failed to remove Apple container sandbox network", {
          containerName: name,
          networkName,
          error,
        }),
      ),
    ),
  );

  return ["--network", networkName];
});

const createContainer = Effect.fn(function* ({
  handle,
  name,
  networkArgs,
  portMappings,
  resources,
  timeout,
}: Readonly<{
  handle: Snapshot.Handle.Handle;
  name: string;
  networkArgs: ReadonlyArray<string>;
  portMappings: ReadonlyArray<PortMapping>;
  resources: Sandbox.Resources;
  timeout: Duration.Input;
}>) {
  const spawner = yield* Spawn.Service;
  yield* timedStart(
    name,
    timeout,
    CP.make(
      "container",
      [
        "create",
        "--rm",
        "--detach",
        "--name",
        name,
        ...networkArgs,
        ...formatPortMappings(portMappings),
        ...formatResources(resources),
        handle.name,
        "sleep",
        "infinity",
      ],
      containerOptions,
    ),
  );
  yield* Effect.logDebug("Apple container sandbox was created", {
    image: handle.name,
    containerName: name,
  });

  yield* Effect.addFinalizer(() =>
    spawner.success(CP.make`container delete --force ${name}`).pipe(
      Effect.tap(() =>
        Effect.logDebug("Removed Apple container sandbox", {
          containerName: name,
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Failed to remove Apple container sandbox", {
          containerName: name,
          error,
        }),
      ),
    ),
  );
});

export const runSandbox = Effect.fn(
  function* ({ handle, portMappings, resources, timeout }: RunOptions) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.Service;
    const name = yield* Sandbox.makeName().pipe(
      Effect.mapError(Sandbox.Error.sandboxStart(handle.name)),
    );
    const networkName = `oi-network-${name.slice(-36)}`;
    yield* Effect.annotateCurrentSpan({
      appleContainerImage: handle.name,
      containerName: name,
    });
    yield* Effect.logDebug("Starting Apple container sandbox", {
      image: handle.name,
      containerName: name,
      portMappings,
      resources,
    });

    yield* ensureSupportedResources(handle, resources);

    const networkArgs = resources.network
      ? []
      : yield* createInternalNetwork({ name, networkName, timeout });

    yield* createContainer({
      handle,
      name,
      networkArgs,
      portMappings,
      resources,
      timeout,
    });

    yield* timedStart(name, timeout, CP.make`container start ${name}`);
    yield* Effect.logDebug("Apple container sandbox is running", {
      image: handle.name,
      containerName: name,
    });

    const spawnerLayer = yield* makeSandboxSpawner(name);
    const sandboxSpawner = yield* Effect.service(Sandbox.Spawn.Service).pipe(
      Effect.provide(spawnerLayer),
    );

    return {
      ...sandboxSpawner,
      cmd: (command) =>
        sandboxSpawner
          .spawn(command)
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(name, formatSandboxCommand(command)))),
      expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
        yield* Effect.logDebug("Exposing Apple container sandbox port", {
          containerName: name,
          sandboxPort,
          expectedHostPort: hostPort,
        });

        const mapping = findPortMapping(portMappings, { sandboxPort, hostPort });
        if (mapping === undefined) {
          return yield* Effect.fail(
            Sandbox.Error.sandboxExpose(
              handle.name,
              sandboxPort,
              hostPort,
            )(
              new Error(
                "Expected port mapping cannot be exposed because it was not specified in the configuration. Apple container requires a host port when the container is created.",
              ),
            ),
          );
        }

        yield* Effect.logDebug("Exposed Apple container sandbox port", {
          containerName: name,
          sandboxPort,
          hostPort: mapping.hostPort,
        });
        return { hostUrl: `http://localhost:${mapping.hostPort}` };
      }),
      download: Effect.fn(function* ({ sandboxPath, hostPath }) {
        const command = CP.make`container copy ${`${name}:${sandboxPath}`} ${hostPath}`;
        yield* spawner
          .success(command)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
      }),
      upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
        const command = CP.make`container copy ${hostPath} ${`${name}:${sandboxPath}`}`;
        yield* spawner
          .success(command)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
      }),
      readFile: Effect.fn(function* ({ sandboxPath }) {
        const command = { command: "cat", args: [sandboxPath] };
        return yield* sandboxSpawner
          .stdout(command)
          .pipe(
            Effect.mapError(Sandbox.Error.sandboxExec(handle.name, formatSandboxCommand(command))),
          );
      }),
      writeFile: Effect.fn(
        function* ({ sandboxPath, content }) {
          const hostPath = yield* fs.makeTempFileScoped({ prefix: "open-insight-apple-upload-" });
          const command = CP.make`container copy ${hostPath} ${`${name}:${sandboxPath}`}`;
          yield* fs.writeFileString(hostPath, content).pipe(
            Effect.andThen(
              spawner
                .success(command)
                .pipe(Effect.timeout(timeout))
                .pipe(
                  Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))),
                ),
            ),
          );
        },
        (effect, { sandboxPath }) =>
          effect
            .pipe(Effect.scoped)
            .pipe(
              Effect.mapError(
                Sandbox.Error.sandboxExec(handle.name, `write ${Bash.quote(sandboxPath)}`),
              ),
            ),
      ),
    } satisfies Sandbox.Sandbox;
  },
  (effect) => effect.pipe(Effect.annotateLogs({ provider: "apple" })),
);
