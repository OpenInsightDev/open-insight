import * as Sandbox from "@/sandbox/index.ts";
import { Spawn } from "@open-insight/utils";
import { SandboxError } from "@/sandbox/error.ts";
import * as Provider from "@/sandbox/provider/index.ts";
import * as Snapshot from "@/sandbox/snapshot/index.ts";
import { Crypto, Effect, FileSystem, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { makeRuntime } from "./utils.ts";

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
}>;

const formatResources = (resources?: Sandbox.ResourceLimits): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB, numGPUs, storageMiB } = resources;
  const resourceArgs: Array<string> = [];
  if (numCPUs !== undefined) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (memoryMiB !== undefined) {
    resourceArgs.push("--memory", `${memoryMiB}m`);
  }

  if (numGPUs !== undefined && numGPUs > 0) {
    resourceArgs.push("--gpus", `count=${numGPUs}`);
  }

  if (storageMiB !== undefined) {
    resourceArgs.push("--storage-opt", `size=${storageMiB}m`);
  }
  return resourceArgs;
};

export const make = Effect.fn("sandbox/provider/docker")(
  function* ({
    portMappings = [],
  }: MakeOptions): Effect.fn.Return<
    Provider.Provider,
    SandboxError,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.SpawnService
  > {
    const runtime = yield* makeRuntime().pipe(Effect.mapError(SandboxError.provider("docker")));

    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.SpawnService;
    const fs = yield* FileSystem.FileSystem;

    const imageExists = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      return yield* spawner.string(CP.make`image inspect ${handle.name}`.pipe(runtime)).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });

    const removeImage = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      yield* spawner.string(CP.make`rmi ${handle.name}`.pipe(runtime)).pipe(Effect.ignore);
    });

    const aquireSnapshot = Effect.fn(
      function* ({ snapshot, context, cache }) {
        const handle = yield* Snapshot.Handle.make(snapshot).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        );

        if (yield* imageExists(handle)) {
          return handle;
        }

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });

        const command = CP.make`build -f ${containerfilePath} -t ${handle.name} ${context}`.pipe(
          runtime,
        );

        const containerfile = yield* Snapshot.encode(snapshot);
        yield* fs.writeFileString(containerfilePath, containerfile);

        yield* spawner.string(command);

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(handle));
        }

        return handle;
      },
      (effect, { snapshot }) => effect.pipe(Effect.mapError(SandboxError.snapshotBuild(snapshot))),
    ) satisfies Provider.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(function* ({ handle, context, instructions }) {
      const derived = yield* Snapshot.Handle.derive({ handle, instructions }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(SandboxError.snapshotBuild(Snapshot.fromImage(handle.name))),
      );

      if (yield* imageExists(derived)) {
        return derived;
      }

      const snapshot = Snapshot.Snapshot.make({ image: handle.name, instructions });
      const mapBuildError = Effect.mapError(SandboxError.snapshotBuild(snapshot));

      const containerfilePath = yield* fs
        .makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        })
        .pipe(mapBuildError);

      const command = CP.make`build -f ${containerfilePath} -t ${derived.name} ${context}`.pipe(
        runtime,
      );

      const containerfile = yield* Snapshot.encode(snapshot).pipe(mapBuildError);
      yield* fs.writeFileString(containerfilePath, containerfile).pipe(mapBuildError);

      yield* spawner.string(command).pipe(mapBuildError);

      yield* Effect.addFinalizer(() => removeImage(derived));

      return derived;
    }) satisfies Provider.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(function* ({ handle, resources }) {
      const name = yield* Sandbox.makeName().pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(SandboxError.sandboxStart(handle.name)),
      );

      const portMappingArgs = portMappings.flatMap((mapping) => [
        "-p",
        `${mapping.hostPort}:${mapping.sandboxPort}`,
      ]);

      const run = CP.make("run", [
        "-it",
        "--rm",
        "--detach",
        "--name",
        name,
        ...portMappingArgs,
        ...formatResources(resources),
        handle.name,
        "sleep",
        "infinity",
      ]).pipe(runtime);

      yield* spawner.string(run).pipe(Effect.mapError(SandboxError.sandboxStart(name)));

      yield* Effect.addFinalizer(() =>
        spawner.string(CP.make`rm --force ${name}`.pipe(runtime)).pipe(Effect.ignore),
      );

      const makeExecCommand = (command: CP.StandardCommand, input?: string) => {
        const args: string[] = [];
        if (input !== undefined) {
          args.push("-i");
        }

        for (const [key, value] of Object.entries(command.options.env ?? {})) {
          if (value !== undefined) {
            args.push("-e", `${key}=${value}`);
          }
        }

        if (command.options.cwd !== undefined) {
          args.push("-w", command.options.cwd);
        }

        args.push(name, "sh", "-c", Sandbox.formatBash(command));

        const options =
          input === undefined
            ? {}
            : ({
                stdin: {
                  stream: Stream.make(input).pipe(Stream.encodeText),
                },
              } satisfies CP.CommandOptions);

        return CP.make("exec", args, options).pipe(runtime);
      };

      return yield* Sandbox.make({
        $(cmd: CP.StandardCommand, input?: string) {
          const bash = Sandbox.formatBash(cmd);
          const execCommand = makeExecCommand(cmd, input);
          return spawner
            .string(execCommand)
            .pipe(
              Effect.mapError(SandboxError.sandboxExec({ name: handle.name, operation: bash })),
            );
        },
        expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
          const matchesMapping = portMappings.some(
            (mapping) => mapping.sandboxPort === sandboxPort && mapping.hostPort === hostPort,
          );

          if (!matchesMapping) {
            return yield* Effect.fail(
              SandboxError.sandboxExpose({ name: handle.name, sandboxPort, hostPort })(
                "Expected port mapping cannot be exposed because it was not specified in the configuration. Containers cannot exposing arbitrary ports that were not mapped when the container was created.",
              ),
            );
          }

          return { hostUrl: `http://localhost:${hostPort}` };
        }),
        download: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const from = `${name}:${sandboxPath}`;
          const command = CP.make`cp ${from} ${hostPath}`;
          yield* spawner.string(command.pipe(runtime)).pipe(
            Effect.mapError(
              SandboxError.sandboxExec({
                name: handle.name,
                operation: Sandbox.formatBash(command),
              }),
            ),
          );
        }),
        upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const to = `${name}:${sandboxPath}`;
          const command = CP.make`cp ${hostPath} ${to}`;
          yield* spawner.string(command.pipe(runtime)).pipe(
            Effect.mapError(
              SandboxError.sandboxExec({
                name: handle.name,
                operation: Sandbox.formatBash(command),
              }),
            ),
          );
        }),
        readFile: "cat",
        writeFile: "tee",
      }).pipe(Effect.provideService(Spawn.SpawnService, spawner));
    }) satisfies Provider.Provider["runSandbox"];

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Provider.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
