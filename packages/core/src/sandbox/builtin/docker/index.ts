import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn, Bash } from "#/utils/index.ts";
import { Crypto, Duration, Effect, FileSystem } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { dockerOptions, formatPortMappings, formatResources, matchesPortMapping } from "./utils.ts";
import { makeSandboxSpawner } from "./spawn.ts";
import * as Runtime from "./runtime.ts";

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort?: number;
}>;

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
  timeout?: Duration.Input;
}>;

const formatSandboxCommand = ({ command, args = [] }: Sandbox.Spawn.Command) =>
  [command, ...args].map(Bash.quote).join(" ");

export const make = Effect.fn("sandbox/provider/docker")(
  function* ({
    portMappings = [],
    timeout = Duration.seconds(30),
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.Error,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.Service
  > {
    const runtime = yield* Runtime.make().pipe(Effect.mapError(Sandbox.Error.provider("docker")));

    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.Service;
    const fs = yield* FileSystem.FileSystem;

    const imageExists = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      const inspect = CP.make(dockerOptions)`image inspect ${handle.name}`.pipe(runtime);
      return yield* spawner.success(inspect).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });

    const removeImage = (handle: Snapshot.Handle.Handle) =>
      Effect.logDebug("Removing uncached Docker image", { image: handle.name }).pipe(
        Effect.andThen(spawner.success(CP.make(dockerOptions)`rmi ${handle.name}`.pipe(runtime))),
        Effect.tap(() =>
          Effect.logDebug("Removed uncached Docker image", {
            image: handle.name,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Failed to remove uncached Docker image", {
            image: handle.name,
            error,
          }),
        ),
      );

    const getHostPort = Effect.fn(function* (name: string, sandboxPort: number) {
      const command = CP.make(dockerOptions)`port ${name} ${sandboxPort}`;
      const output = yield* spawner
        .string(command)
        .pipe(Effect.mapError(Sandbox.Error.sandboxExpose(name, sandboxPort)));

      const port = Number(output.trim().split(":").at(-1));
      if (!Number.isInteger(port)) {
        return yield* Effect.fail(
          Sandbox.Error.sandboxExpose(
            name,
            sandboxPort,
          )(new Error(`Docker did not report a host port for sandbox port ${sandboxPort}`)),
        );
      }

      yield* Effect.logDebug("Resolved Docker sandbox port", {
        containerName: name,
        sandboxPort,
        hostPort: port,
      });

      return port;
    });

    const aquireSnapshot = Effect.fn(
      function* ({ snapshot, cache }) {
        const handle = yield* Snapshot.Handle.make(snapshot);
        yield* Effect.annotateCurrentSpan({
          dockerImage: handle.name,
          snapshotContext: snapshot.context,
        });

        if (yield* imageExists(handle)) {
          yield* Effect.logDebug("Using cached Docker snapshot image", {
            image: handle.name,
            context: snapshot.context,
          });
          return handle;
        }

        yield* Effect.logInfo("Building Docker snapshot image", {
          image: handle.name,
          context: snapshot.context,
          cache: cache ?? false,
        });

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });

        const containerfile = yield* Snapshot.encode(snapshot);
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build = CP.make(
          "build",
          ["-f", containerfilePath, "-t", handle.name, snapshot.context],
          dockerOptions,
        ).pipe(runtime);
        yield* spawner.success(build);
        yield* Effect.logInfo("Built Docker snapshot image", {
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
          Effect.annotateLogs({
            snapshotContext: snapshot.context,
          }),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.build(snapshot))),
        ),
    ) satisfies Sandbox.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(
      function* ({ handle, context, instructions, cache }) {
        const derived = yield* Snapshot.Handle.derive({ handle, instructions });
        yield* Effect.annotateCurrentSpan({
          baseDockerImage: handle.name,
          dockerImage: derived.name,
          snapshotContext: context,
        });

        if (yield* imageExists(derived)) {
          yield* Effect.logDebug("Using cached derived Docker image", {
            baseImage: handle.name,
            image: derived.name,
            context,
          });
          return derived;
        }

        yield* Effect.logInfo("Building derived Docker image", {
          baseImage: handle.name,
          image: derived.name,
          context,
          cache: cache ?? false,
        });

        const containerfile = yield* Snapshot.encode({
          image: handle.name,
          instructions,
        });

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build = CP.make(
          "build",
          ["-f", containerfilePath, "-t", derived.name, context],
          dockerOptions,
        ).pipe(runtime);
        yield* spawner.success(build);
        yield* Effect.logInfo("Built derived Docker image", {
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
          Effect.annotateLogs({
            baseDockerImage: handle.name,
          }),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.derive(handle.name, instructions))),
        ),
    ) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(
      function* ({ handle, resources }) {
        const name = yield* Sandbox.makeName().pipe(
          Effect.mapError(Sandbox.Error.sandboxStart(handle.name)),
        );
        yield* Effect.annotateCurrentSpan({
          dockerImage: handle.name,
          containerName: name,
        });
        yield* Effect.logDebug("Starting Docker sandbox container", {
          image: handle.name,
          containerName: name,
          portMappings,
          resources,
        });

        const run = CP.make(
          "run",
          [
            "--rm",
            "--detach",
            "--name",
            name,
            ...formatPortMappings(portMappings),
            ...formatResources(resources),
            handle.name,
            "sleep",
            "infinity",
          ],
          dockerOptions,
        ).pipe(runtime);
        yield* spawner
          .success(run)
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));
        yield* Effect.logDebug("Docker sandbox container was created", {
          image: handle.name,
          containerName: name,
        });

        yield* Effect.addFinalizer(() =>
          spawner.success(CP.make(dockerOptions)`rm --force ${name}`.pipe(runtime)).pipe(
            Effect.tap(() =>
              Effect.logDebug("Removed Docker sandbox container", {
                containerName: name,
              }),
            ),
            Effect.catch((error) =>
              Effect.logWarning("Failed to remove Docker sandbox container", {
                containerName: name,
                error,
              }),
            ),
          ),
        );

        const isRunning = yield* spawner
          .string(CP.make`inspect --format "{{.State.Running}}" ${name}`.pipe(runtime))
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.map((output) => output.trim() === "true"))
          .pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));

        if (!isRunning) {
          return yield* Effect.fail(
            Sandbox.Error.sandboxStart(name)(
              new Error("Docker container was created but did not reach running state"),
            ),
          );
        }
        yield* Effect.logDebug("Docker sandbox container is running", {
          image: handle.name,
          containerName: name,
        });

        const spawnerLayer = yield* makeSandboxSpawner(name).pipe(
          Effect.provideService(Runtime.Runtime, runtime),
        );
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
            yield* Effect.logDebug("Exposing Docker sandbox port", {
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
                    "Expected port mapping cannot be exposed because it was not specified in the configuration. Containers cannot exposing arbitrary ports that were not mapped when the container was created.",
                  ),
                ),
              );
            }

            const actualHostPort = yield* getHostPort(name, sandboxPort);

            if (hostPort !== undefined && actualHostPort !== hostPort) {
              return yield* Effect.fail(
                Sandbox.Error.sandboxExpose(
                  handle.name,
                  sandboxPort,
                  hostPort,
                )(
                  new Error(
                    `Expected sandbox port ${sandboxPort} to be exposed on host port ${hostPort}, but Docker reported host port ${actualHostPort}`,
                  ),
                ),
              );
            }

            yield* Effect.logDebug("Exposed Docker sandbox port", {
              containerName: name,
              sandboxPort,
              hostPort: actualHostPort,
            });

            return { hostUrl: `http://localhost:${actualHostPort}` };
          }),
          download: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make(dockerOptions)`cp ${name}:${sandboxPath} ${hostPath}`;
            yield* Effect.logDebug("Downloading file from Docker sandbox", {
              containerName: name,
              sandboxPath,
              hostPath,
            });
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.timeout(timeout))
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
            yield* Effect.logDebug("Downloaded file from Docker sandbox", {
              containerName: name,
              sandboxPath,
              hostPath,
            });
          }),
          upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make(dockerOptions)`cp ${hostPath} ${name}:${sandboxPath}`;
            yield* Effect.logDebug("Uploading file to Docker sandbox", {
              containerName: name,
              hostPath,
              sandboxPath,
            });
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.timeout(timeout))
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
            yield* Effect.logDebug("Uploaded file to Docker sandbox", {
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
                Effect.mapError(
                  Sandbox.Error.sandboxExec(handle.name, formatSandboxCommand(command)),
                ),
              );
          }),
          writeFile: Effect.fn(
            function* ({ sandboxPath, content }) {
              const hostPath = yield* fs.makeTempFile({
                prefix: "open-insight-docker-upload-",
              });
              const command = CP.make(dockerOptions)`cp ${hostPath} ${name}:${sandboxPath}`;
              yield* Effect.logDebug("Writing file to Docker sandbox", {
                containerName: name,
                sandboxPath,
                bytes: new TextEncoder().encode(content).byteLength,
              });
              yield* fs.writeFileString(hostPath, content).pipe(
                Effect.andThen(
                  spawner
                    .success(command.pipe(runtime))
                    .pipe(Effect.timeout(timeout))
                    .pipe(
                      Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))),
                    ),
                ),
                Effect.ensuring(fs.remove(hostPath, { force: true }).pipe(Effect.ignore)),
              );
              yield* Effect.logDebug("Wrote file to Docker sandbox", {
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
      (effect) =>
        effect.pipe(
          Effect.provideService(Spawn.Service, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.annotateLogs({
            provider: "docker",
          }),
        ),
    ) satisfies Sandbox.Provider["runSandbox"];

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);
