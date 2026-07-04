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

const formatResources = (resources: Sandbox.ResourceLimits | null): Array<string> => {
  if (resources === null) {
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

    const ensureSnapshot = Effect.fn(function* ({ snapshot, context }) {
      const mapBuildError = Effect.mapError(SandboxError.snapshotBuild(snapshot));

      const name = yield* Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapBuildError,
      );

      const imageExists = yield* spawner.string(CP.make`image inspect ${name}`.pipe(runtime)).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (imageExists) {
        return;
      }

      const containerfilePath = yield* fs
        .makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        })
        .pipe(mapBuildError);

      const command = CP.make`build -f ${containerfilePath} -t ${name} ${context}`.pipe(runtime);

      const containerfile = yield* Snapshot.encode(snapshot).pipe(mapBuildError);
      yield* fs.writeFileString(containerfilePath, containerfile).pipe(mapBuildError);

      yield* spawner.string(command).pipe(mapBuildError);
    }) satisfies Provider.Provider["ensureSnapshot"];

    const removeSnapshot = Effect.fn(function* ({ snapshot }) {
      const mapBuildError = Effect.mapError(SandboxError.snapshotBuild(snapshot));
      const name = yield* Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapBuildError,
      );

      const command = CP.make`rmi ${name}`.pipe(runtime);

      yield* spawner.string(command).pipe(mapBuildError);
    }) satisfies Provider.Provider["removeSnapshot"];

    const deriveSnapshot = Effect.fn(function* ({ snapshot, context, instructions }) {
      yield* ensureSnapshot({ snapshot, context });

      const name = yield* Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(SandboxError.snapshotBuild(snapshot)),
      );
      const derived = Snapshot.Snapshot.make({ image: name, instructions });
      yield* ensureSnapshot({ snapshot: derived, context });
    }) satisfies Provider.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(function* ({ snapshot, resources }) {
      const mapUsageError = Effect.mapError(SandboxError.snapshotUsage(snapshot));

      const name = yield* Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapUsageError,
      );

      const sandboxName = yield* Sandbox.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapUsageError,
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
        sandboxName,
        ...portMappingArgs,
        ...formatResources(resources),
        name,
        "sleep",
        "infinity",
      ]).pipe(runtime);

      yield* spawner.string(run).pipe(Effect.mapError(SandboxError.sandboxStart(sandboxName)));

      yield* Effect.addFinalizer(() =>
        spawner.string(CP.make`rm --force ${sandboxName}`.pipe(runtime)).pipe(Effect.ignore),
      );

      const makeExecCommand = (command: CP.StandardCommand, input?: string) => {
        const args = [];
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

        args.push(sandboxName, "sh", "-c", Sandbox.formatBash(command));

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
            .pipe(Effect.mapError(SandboxError.sandboxExec({ name, operation: bash })));
        },
        expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
          const matchesMapping = portMappings.some(
            (mapping) => mapping.sandboxPort === sandboxPort && mapping.hostPort === hostPort,
          );

          if (!matchesMapping) {
            return yield* Effect.fail(
              SandboxError.sandboxExpose({ name, sandboxPort, hostPort })(
                "Expected port mapping cannot be exposed because it was not specified in the configuration. Containers cannot exposing arbitrary ports that were not mapped when the container was created.",
              ),
            );
          }

          return { hostUrl: `http://localhost:${hostPort}` };
        }),
        download: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const from = `${sandboxName}:${sandboxPath}`;
          const command = CP.make`cp ${from} ${hostPath}`;
          yield* spawner.string(command.pipe(runtime)).pipe(
            Effect.mapError(
              SandboxError.sandboxExec({
                name,
                operation: Sandbox.formatBash(command),
              }),
            ),
          );
        }),
        upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const to = `${sandboxName}:${sandboxPath}`;
          const command = CP.make`cp ${hostPath} ${to}`;
          yield* spawner.string(command.pipe(runtime)).pipe(
            Effect.mapError(
              SandboxError.sandboxExec({
                name,
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
      ensureSnapshot,
      deriveSnapshot,
      removeSnapshot,
      runSandbox,
    } satisfies Provider.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
