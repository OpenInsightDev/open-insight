import { SandboxError } from "#/sandbox/export.ts";
import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import * as Spawn from "#/spawn/export.ts";
import { Bash } from "#/utils/export.ts";
import { Crypto, Duration, Effect, FileSystem, Layer, Match } from "effect";
import { ChildProcessSpawner, ChildProcess as CP } from "effect/unstable/process";
import { formatPorts, formatResources, hasPort } from "./utils.ts";
import { makeSandboxSpawner } from "./spawn.ts";
import * as Runtime from "./runtime.ts";

export type Options = Readonly<{
  ports?: Array<number>;
  timeout?: Duration.Input;
}>;

const formatSandboxCommand = ({ command, args = [] }: Sandbox.Spawn.Command) =>
  [command, ...args].map(Bash.quote).join(" ");

export const make = Effect.fn("sandbox/provider/docker")(
  function* ({
    ports = [],
    timeout = "30 seconds",
  }: Options): Effect.fn.Return<
    Sandbox.Provider,
    SandboxError,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.Service | ChildProcessSpawner.ChildProcessSpawner
  > {
    const runtime = yield* Runtime.make().pipe(Effect.mapError(SandboxError.provider("docker")));

    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.Service;
    const fs = yield* FileSystem.FileSystem;

    const imageExists = Effect.fn(function* (snapshot: Snapshot.Snapshot) {
      const inspect = CP.make`image inspect ${snapshot.name}`.pipe(runtime);
      return yield* spawner.success(inspect).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });

    const removeImage = (snapshot: Snapshot.Snapshot) =>
      Effect.logDebug("Removing uncached Docker image", { image: snapshot.name }).pipe(
        Effect.andThen(spawner.success(CP.make`rmi ${snapshot.name}`.pipe(runtime))),
        Effect.tap(() =>
          Effect.logDebug("Removed uncached Docker image", {
            image: snapshot.name,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("Failed to remove uncached Docker image", {
            image: snapshot.name,
            error,
          }),
        ),
      );

    const getHostPort = Effect.fn(function* (name: string, sandboxPort: number) {
      const command = CP.make`port ${name} ${sandboxPort}`.pipe(runtime);
      const output = yield* spawner
        .string(command)
        .pipe(Effect.mapError(SandboxError.sandboxExpose(name, sandboxPort)));

      const port = Number(output.trim().split(":").at(-1));
      if (!Number.isInteger(port)) {
        return yield* Effect.fail(
          SandboxError.sandboxExpose(
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

    const removeContainer = (name: string) =>
      spawner.success(CP.make`rm --force ${name}`.pipe(runtime)).pipe(
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
      );

    const acquireSnapshot = Effect.fn(
      function* ({ template, cache }) {
        const snapshot = yield* Snapshot.make(template);

        yield* Effect.annotateCurrentSpan({
          dockerImage: snapshot.name,
          snapshotContext: template.context,
        });

        if (yield* imageExists(snapshot)) {
          yield* Effect.logDebug("Using cached Docker snapshot image", {
            image: snapshot.name,
            context: template.context,
          });
          return snapshot;
        }

        yield* Effect.logInfo("Building Docker snapshot image", {
          image: snapshot.name,
          context: template.context,
          cache,
        });

        const containerfilePath = yield* Match.value(template).pipe(
          Match.tag("Containerfile", ({ filePath }) => Effect.succeed(filePath)),
          Match.tag("Instructions", (instructionsTemplate) =>
            Snapshot.writeInstructions(instructionsTemplate),
          ),
          Match.exhaustive,
        );

        yield* spawner.success(
          CP.make`build -f ${containerfilePath} -t ${snapshot.name} ${template.context}`.pipe(
            runtime,
          ),
        );
        yield* Effect.logInfo("Built Docker snapshot image", {
          image: snapshot.name,
          context: template.context,
        });

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(snapshot));
        }

        return snapshot;
      },
      (effect, { template }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.annotateLogs({
            snapshotContext: template.context,
          }),
          Effect.mapError(SandboxError.snapshot(Snapshot.SnapshotError.build(template))),
        ),
    ) satisfies Sandbox.Provider["acquireSnapshot"];

    const deriveSnapshot = Effect.fn(
      function* ({ snapshot, context, instructions, cache }) {
        const derived = yield* Snapshot.derive({ snapshot, instructions });
        yield* Effect.annotateCurrentSpan({
          baseDockerImage: snapshot.name,
          dockerImage: derived.name,
          snapshotContext: context,
        });

        if (yield* imageExists(derived)) {
          yield* Effect.logDebug("Using cached derived Docker image", {
            baseImage: snapshot.name,
            image: derived.name,
            context,
          });
          return derived;
        }

        yield* Effect.logInfo("Building derived Docker image", {
          baseImage: snapshot.name,
          image: derived.name,
          context,
          cache,
        });

        const containerfilePath = yield* Snapshot.writeInstructions(
          Snapshot.extend(instructions)(
            Snapshot.makeTemplateWith({ image: snapshot.name, instructions: [], context }),
          ),
        );

        const build = CP.make`build -f ${containerfilePath} -t ${derived.name} ${context}`.pipe(
          runtime,
        );
        yield* spawner.success(build);
        yield* Effect.logInfo("Built derived Docker image", {
          baseImage: snapshot.name,
          image: derived.name,
          context,
        });

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(derived));
        }

        return derived;
      },
      (effect, { snapshot, instructions }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.annotateLogs({
            baseDockerImage: snapshot.name,
          }),
          Effect.mapError(
            SandboxError.snapshot(Snapshot.SnapshotError.derive(snapshot.name, instructions)),
          ),
        ),
    ) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(
      function* ({ snapshot, resources }) {
        const name = yield* Sandbox.makeName().pipe(
          Effect.mapError(SandboxError.sandboxStart(snapshot.name)),
        );
        yield* Effect.annotateCurrentSpan({
          dockerImage: snapshot.name,
          containerName: name,
        });
        yield* Effect.logDebug("Starting Docker sandbox container", {
          image: snapshot.name,
          containerName: name,
          ports,
          resources,
        });

        const portArgs = formatPorts(ports);
        const resourceArgs = formatResources(resources);
        const run = CP.make`run --rm --detach
          --name ${name}
          ${portArgs}
          ${resourceArgs}
          ${snapshot.name}`.pipe(runtime);

        yield* Effect.acquireRelease(
          spawner.success(run).pipe(
            Effect.timeout(timeout),
            Effect.onError(() => removeContainer(name)),
            Effect.mapError(SandboxError.sandboxStart(name)),
          ),
          () => removeContainer(name),
        );
        yield* Effect.logDebug("Docker sandbox container was created", {
          image: snapshot.name,
          containerName: name,
        });

        const isRunning = yield* spawner
          .string(CP.make`inspect --format {{.State.Running}} ${name}`.pipe(runtime))
          .pipe(Effect.timeout(timeout))
          .pipe(Effect.map((output) => output.trim() === "true"))
          .pipe(Effect.mapError(SandboxError.sandboxStart(name)));

        if (!isRunning) {
          return yield* Effect.fail(
            SandboxError.sandboxStart(name)(
              new Error("Docker container was created but did not reach running state"),
            ),
          );
        }
        yield* Effect.logDebug("Docker sandbox container is running", {
          image: snapshot.name,
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
          spawn: (command) => sandboxSpawner.spawn(command),
          expose: Effect.fn(function* ({ sandboxPort }) {
            yield* Effect.logDebug("Exposing Docker sandbox port", {
              containerName: name,
              sandboxPort,
            });

            if (!hasPort(ports, sandboxPort)) {
              return yield* Effect.fail(
                SandboxError.sandboxExpose(
                  snapshot.name,
                  sandboxPort,
                )(
                  new Error(
                    "The sandbox port cannot be exposed because it was not specified in the provider configuration. Docker requires ports to be published when the container is created.",
                  ),
                ),
              );
            }

            const actualHostPort = yield* getHostPort(name, sandboxPort);

            yield* Effect.logDebug("Exposed Docker sandbox port", {
              containerName: name,
              sandboxPort,
              hostPort: actualHostPort,
            });

            return { hostUrl: `http://localhost:${actualHostPort}` };
          }),
          download: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make`cp ${name}:${sandboxPath} ${hostPath}`;
            yield* Effect.logDebug("Downloading file from Docker sandbox", {
              containerName: name,
              sandboxPath,
              hostPath,
            });
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.timeout(timeout))
              .pipe(Effect.mapError(SandboxError.sandboxExec(snapshot.name, Bash.format(command))));
            yield* Effect.logDebug("Downloaded file from Docker sandbox", {
              containerName: name,
              sandboxPath,
              hostPath,
            });
          }),
          upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make`cp ${hostPath} ${name}:${sandboxPath}`;
            yield* Effect.logDebug("Uploading file to Docker sandbox", {
              containerName: name,
              hostPath,
              sandboxPath,
            });
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.timeout(timeout))
              .pipe(Effect.mapError(SandboxError.sandboxExec(snapshot.name, Bash.format(command))));
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
                  SandboxError.sandboxExec(snapshot.name, formatSandboxCommand(command)),
                ),
              );
          }),
          writeFile: Effect.fn(
            function* ({ sandboxPath, content }) {
              const hostPath = yield* fs.makeTempFile({
                prefix: "open-insight-docker-upload-",
              });
              const command = CP.make`cp ${hostPath} ${name}:${sandboxPath}`;
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
                      Effect.mapError(
                        SandboxError.sandboxExec(snapshot.name, Bash.format(command)),
                      ),
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
                  SandboxError.sandboxExec(snapshot.name, `write ${Bash.quote(sandboxPath)}`),
                ),
              ),
          ),
        } satisfies Sandbox.Sandbox;
      },
      (effect) =>
        effect.pipe(
          Effect.provideService(Spawn.Service, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.annotateLogs({ provider: "docker" }),
        ),
    ) satisfies Sandbox.Provider["runSandbox"];

    return {
      acquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

export const layerFrom = (
  options: Options,
): Layer.Layer<
  Sandbox.ProviderService,
  SandboxError,
  Crypto.Crypto | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> => Layer.effect(Sandbox.ProviderService)(make(options));

export const layer = layerFrom({});
