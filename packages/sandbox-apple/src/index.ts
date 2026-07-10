import { Sandbox, Snapshot } from "@open-insight/core";
import { Bash, Spawn } from "@open-insight/core/utils";
import { Crypto, Duration, Effect, FileSystem } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { makeSandboxSpawner } from "./spawn.ts";
import {
  containerOptions,
  formatPortMappings,
  formatResources,
  matchesPortMapping,
  minimumMemoryMiB,
} from "./utils.ts";

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
  timeout?: Duration.Input;
}>;

const formatSandboxCommand = ({ command, args = [] }: Sandbox.Spawn.Command) =>
  [command, ...args].map(Bash.quote).join(" ");

export const make = Effect.fn("sandbox/provider/apple")(
  function* ({
    portMappings = [],
    timeout = Duration.seconds(30),
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.Error,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.Service
  > {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.Service;
    const fs = yield* FileSystem.FileSystem;

    yield* spawner
      .success(CP.make("container", ["builder", "start"], containerOptions))
      .pipe(Effect.mapError(Sandbox.Error.provider("apple")));

    const imageExists = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      const inspect = CP.make("container", ["image", "inspect", handle.name], containerOptions);
      return yield* spawner.success(inspect).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });

    const removeImage = (handle: Snapshot.Handle.Handle) =>
      Effect.logDebug("Removing uncached Apple container image", { image: handle.name }).pipe(
        Effect.andThen(
          spawner.success(
            CP.make("container", ["image", "delete", "--force", handle.name], containerOptions),
          ),
        ),
        Effect.tap(() =>
          Effect.logDebug("Removed uncached Apple container image", {
            image: handle.name,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Failed to remove uncached Apple container image", {
            image: handle.name,
            error,
          }),
        ),
      );

    const aquireSnapshot = Effect.fn(
      function* ({ snapshot, cache }) {
        const handle = yield* Snapshot.Handle.make(snapshot);
        yield* Effect.annotateCurrentSpan({
          appleContainerImage: handle.name,
          snapshotContext: snapshot.context,
        });

        if (yield* imageExists(handle)) {
          yield* Effect.logDebug("Using cached Apple container snapshot image", {
            image: handle.name,
            context: snapshot.context,
          });
          return handle;
        }

        yield* Effect.logInfo("Building Apple container snapshot image", {
          image: handle.name,
          context: snapshot.context,
          cache: cache ?? false,
        });

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });
        const containerfile = yield* Snapshot.encode(snapshot);
        const context = yield* fs.realPath(snapshot.context);
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build = CP.make(
          "container",
          ["build", "--file", containerfilePath, "--tag", handle.name, context],
          containerOptions,
        );
        yield* spawner.success(build);
        yield* Effect.logInfo("Built Apple container snapshot image", {
          image: handle.name,
          context: snapshot.context,
        });

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(handle));
        }

        return handle;
      },
      (effect, { snapshot }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.annotateLogs({ snapshotContext: snapshot.context }),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.build(snapshot))),
        ),
    ) satisfies Sandbox.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(
      function* ({ handle, context, instructions, cache }) {
        const derived = yield* Snapshot.Handle.derive({ handle, instructions });
        yield* Effect.annotateCurrentSpan({
          baseAppleContainerImage: handle.name,
          appleContainerImage: derived.name,
          snapshotContext: context,
        });

        if (yield* imageExists(derived)) {
          yield* Effect.logDebug("Using cached derived Apple container image", {
            baseImage: handle.name,
            image: derived.name,
            context,
          });
          return derived;
        }

        yield* Effect.logInfo("Building derived Apple container image", {
          baseImage: handle.name,
          image: derived.name,
          context,
          cache: cache ?? false,
        });

        const containerfile = yield* Snapshot.encode({ image: handle.name, instructions });
        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });
        const buildContext = yield* fs.realPath(context);
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build = CP.make(
          "container",
          ["build", "--file", containerfilePath, "--tag", derived.name, buildContext],
          containerOptions,
        );
        yield* spawner.success(build);
        yield* Effect.logInfo("Built derived Apple container image", {
          baseImage: handle.name,
          image: derived.name,
          context,
        });

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(derived));
        }

        return derived;
      },
      (effect, { handle, instructions }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.annotateLogs({ baseAppleContainerImage: handle.name }),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.derive(handle.name, instructions))),
        ),
    ) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(
      function* ({ handle, resources }) {
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

        if (!Sandbox.isUnlimited(resources.memoryMiB) && resources.memoryMiB < minimumMemoryMiB) {
          return yield* Effect.fail(
            Sandbox.Error.sandboxStart(handle.name)(
              new Error(
                `Apple container requires at least ${minimumMemoryMiB} MiB of memory, received ${resources.memoryMiB} MiB`,
              ),
            ),
          );
        }

        const networkArgs = resources.network
          ? []
          : yield* Effect.gen(function* () {
              yield* spawner
                .success(
                  CP.make(
                    "container",
                    ["network", "create", "--internal", networkName],
                    containerOptions,
                  ),
                )
                .pipe(Effect.timeout(timeout))
                .pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));
              yield* Effect.addFinalizer(() =>
                spawner
                  .success(
                    CP.make("container", ["network", "delete", networkName], containerOptions),
                  )
                  .pipe(
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

        const create = CP.make(
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
        );
        yield* spawner
          .success(create)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));
        yield* Effect.logDebug("Apple container sandbox was created", {
          image: handle.name,
          containerName: name,
        });

        yield* Effect.addFinalizer(() =>
          spawner.success(CP.make("container", ["delete", "--force", name], containerOptions)).pipe(
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

        yield* spawner
          .success(CP.make("container", ["start", name], containerOptions))
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));
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
              .pipe(
                Effect.mapError(Sandbox.Error.sandboxExec(name, formatSandboxCommand(command))),
              ),
          expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
            yield* Effect.logDebug("Exposing Apple container sandbox port", {
              containerName: name,
              sandboxPort,
              expectedHostPort: hostPort,
            });

            if (!matchesPortMapping(portMappings, { sandboxPort, hostPort })) {
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

            const mapping = portMappings.find(
              (portMapping) =>
                portMapping.sandboxPort === sandboxPort &&
                (hostPort === undefined || portMapping.hostPort === hostPort),
            );
            if (mapping === undefined) {
              return yield* Effect.fail(
                Sandbox.Error.sandboxExpose(
                  handle.name,
                  sandboxPort,
                  hostPort,
                )(
                  new Error(
                    `Apple container did not report a host port for sandbox port ${sandboxPort}`,
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
            const command = CP.make(
              "container",
              ["copy", `${name}:${sandboxPath}`, hostPath],
              containerOptions,
            );
            yield* spawner
              .success(command)
              .pipe(Effect.timeout(timeout))
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
          }),
          upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make(
              "container",
              ["copy", hostPath, `${name}:${sandboxPath}`],
              containerOptions,
            );
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
                Effect.mapError(
                  Sandbox.Error.sandboxExec(handle.name, formatSandboxCommand(command)),
                ),
              );
          }),
          writeFile: Effect.fn(
            function* ({ sandboxPath, content }) {
              const hostPath = yield* fs.makeTempFile({ prefix: "open-insight-apple-upload-" });
              const command = CP.make(
                "container",
                ["copy", hostPath, `${name}:${sandboxPath}`],
                containerOptions,
              );
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
      (effect) =>
        effect.pipe(
          Effect.provideService(Spawn.Service, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.annotateLogs({ provider: "apple" }),
        ),
    ) satisfies Sandbox.Provider["runSandbox"];

    return { aquireSnapshot, deriveSnapshot, runSandbox } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);
