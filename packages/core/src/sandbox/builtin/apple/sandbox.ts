import * as Sandbox from "#/sandbox/export.ts";
import * as Resource from "#/resource/index.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Bash, Spawn } from "#/utils/export.ts";
import { Duration, Effect, FileSystem, Option } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { makeSandboxSpawner } from "./spawn.ts";
import {
  containerOptions,
  formatResources,
  minimumMemoryMiB,
  parseContainerHost,
} from "./utils.ts";

type RunOptions = Readonly<{
  handle: Snapshot.Handle.Handle;
  resources: Resource.Resources;
  timeout: Duration.Input;
}>;

const formatSandboxCommand = ({ command, args = [] }: Sandbox.Spawn.Command) =>
  [command, ...args].map(Bash.quote).join(" ");

const ensureSupportedResources = Effect.fn(function* (
  handle: Snapshot.Handle.Handle,
  resources: Resource.Resources,
) {
  if (Option.isNone(resources.memoryMiB) || resources.memoryMiB.value >= minimumMemoryMiB) {
    return;
  }

  return yield* Effect.fail(
    Sandbox.Error.sandboxStart(handle.name)(
      new Error(
        `Apple container requires at least ${minimumMemoryMiB} MiB of memory, received ${resources.memoryMiB.value} MiB`,
      ),
    ),
  );
});

export const runSandbox = Effect.fn(
  function* ({ handle, resources, timeout }: RunOptions) {
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
      resources,
    });

    yield* ensureSupportedResources(handle, resources);

    const start = Effect.fn(function* (command: CP.Command) {
      yield* spawner
        .success(command)
        .pipe(Effect.timeout(timeout), Effect.mapError(Sandbox.Error.sandboxStart(name)));
    });

    const removeContainer = Effect.fn(function* () {
      yield* spawner.success(CP.make`container delete --force ${name}`).pipe(
        Effect.tap(() =>
          Effect.logDebug("Removed Apple sandbox container", {
            containerName: name,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Failed to remove Apple sandbox container", {
            containerName: name,
            error,
          }),
        ),
      );
    });

    const removeNetwork = Effect.fn(function* () {
      yield* spawner.success(CP.make`container network delete ${networkName}`).pipe(
        Effect.tap(() =>
          Effect.logDebug("Removed Apple sandbox network", {
            containerName: name,
            networkName,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Failed to remove Apple sandbox network", {
            containerName: name,
            networkName,
            error,
          }),
        ),
      );
    });

    const getContainerHost = Effect.fn(function* (sandboxPort: number) {
      const output = yield* spawner
        .string(CP.make`container inspect ${name}`)
        .pipe(
          Effect.timeout(timeout),
          Effect.mapError(Sandbox.Error.sandboxExpose(name, sandboxPort)),
        );
      const host = yield* parseContainerHost(output).pipe(
        Effect.mapError(Sandbox.Error.sandboxExpose(name, sandboxPort)),
      );

      yield* Effect.logDebug("Resolved Apple sandbox host", {
        containerName: name,
        sandboxPort,
        host,
      });
      return host;
    });

    const networkArgs =
      Option.isSome(resources.network) && Resource.isNoNetwork(resources.network.value)
        ? yield* Effect.acquireRelease(
            start(CP.make`container network create --internal ${networkName}`).pipe(
              Effect.onError(removeNetwork),
              Effect.as(["--network", networkName]),
            ),
            removeNetwork,
          )
        : [];

    const resourceArgs = yield* formatResources(handle.name, resources);
    const create = CP.make(
      "container",
      [
        "create",
        "--rm",
        "--detach",
        "--name",
        name,
        ...networkArgs,
        ...resourceArgs,
        handle.name,
        "sleep",
        "infinity",
      ],
      containerOptions,
    );
    yield* Effect.acquireRelease(
      start(create).pipe(Effect.onError(removeContainer)),
      removeContainer,
    );
    yield* Effect.logDebug("Apple sandbox container was created", {
      image: handle.name,
      containerName: name,
    });

    yield* start(CP.make`container start ${name}`);
    yield* Effect.logDebug("Apple sandbox container is running", {
      image: handle.name,
      containerName: name,
    });

    const spawnerLayer = yield* makeSandboxSpawner(name);
    const sandboxSpawner = yield* Effect.service(Sandbox.Spawn.Service).pipe(
      Effect.provide(spawnerLayer),
    );

    return {
      ...sandboxSpawner,
      cmd: Effect.fn(function* (command) {
        return yield* sandboxSpawner
          .spawn(command)
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(name, formatSandboxCommand(command))));
      }),
      expose: Effect.fn(function* ({ sandboxPort }) {
        yield* Effect.logDebug("Exposing Apple container sandbox port", {
          containerName: name,
          sandboxPort,
        });

        const host = yield* getContainerHost(sandboxPort);

        yield* Effect.logDebug("Exposed Apple container sandbox port", {
          containerName: name,
          sandboxPort,
          host,
        });
        return { hostUrl: `http://${host}:${sandboxPort}` };
      }),
      download: Effect.fn(function* ({ sandboxPath, hostPath }) {
        const command = CP.make`container copy ${`${name}:${sandboxPath}`} ${hostPath}`;
        yield* Effect.logDebug("Downloading file from Apple sandbox", {
          containerName: name,
          sandboxPath,
          hostPath,
        });
        yield* spawner
          .success(command)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
        yield* Effect.logDebug("Downloaded file from Apple sandbox", {
          containerName: name,
          sandboxPath,
          hostPath,
        });
      }),
      upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
        const command = CP.make`container copy ${hostPath} ${`${name}:${sandboxPath}`}`;
        yield* Effect.logDebug("Uploading file to Apple sandbox", {
          containerName: name,
          hostPath,
          sandboxPath,
        });
        yield* spawner
          .success(command)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
        yield* Effect.logDebug("Uploaded file to Apple sandbox", {
          containerName: name,
          hostPath,
          sandboxPath,
        });
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
          const hostPath = yield* fs.makeTempFile({ prefix: "open-insight-apple-upload-" });
          const command = CP.make`container copy ${hostPath} ${`${name}:${sandboxPath}`}`;
          yield* Effect.logDebug("Writing file to Apple sandbox", {
            containerName: name,
            sandboxPath,
            bytes: new TextEncoder().encode(content).byteLength,
          });
          yield* fs.writeFileString(hostPath, content).pipe(
            Effect.andThen(
              spawner
                .success(command)
                .pipe(Effect.timeout(timeout))
                .pipe(
                  Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))),
                ),
            ),
            Effect.ensuring(fs.remove(hostPath, { force: true }).pipe(Effect.ignore)),
          );
          yield* Effect.logDebug("Wrote file to Apple sandbox", {
            containerName: name,
            sandboxPath,
          });
        },
        (effect, { sandboxPath }) =>
          effect.pipe(
            Effect.mapError(
              Sandbox.Error.sandboxExec(handle.name, `write ${Bash.quote(sandboxPath)}`),
            ),
          ),
      ),
    } satisfies Sandbox.Sandbox;
  },
  (effect) => effect.pipe(Effect.annotateLogs({ provider: "apple" })),
);
