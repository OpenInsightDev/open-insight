import * as Sandbox from "#/sandbox/export.ts";
import * as Snapshot from "#/snapshot/export.ts";
import { Spawn, Bash } from "#/utils/index.ts";
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

const formatResources = (resources: Sandbox.Resources | null): Array<string> => {
  if (!resources) {
    return [];
  }

  const { numCPUs, memoryMiB, numGPUs, storageMiB, network } = resources;
  const resourceArgs: Array<string> = [];
  if (!Sandbox.isUnlimited(numCPUs)) {
    resourceArgs.push("--cpus", `${numCPUs}`);
  }

  if (!Sandbox.isUnlimited(memoryMiB)) {
    resourceArgs.push("--memory", `${memoryMiB}m`);
  }

  if (!Sandbox.isUnlimited(numGPUs) && numGPUs > 0) {
    resourceArgs.push("--gpus", `count=${numGPUs}`);
  }

  if (!Sandbox.isUnlimited(storageMiB)) {
    resourceArgs.push("--storage-opt", `size=${storageMiB}m`);
  }

  if (!network) {
    resourceArgs.push("--network", "none");
  }

  return resourceArgs;
};

export const make = Effect.fn("sandbox/provider/docker")(
  function* ({
    portMappings = [],
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.Error,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.SpawnService
  > {
    const runtime = yield* makeRuntime().pipe(Effect.mapError(Sandbox.Error.provider("docker")));

    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.SpawnService;
    const fs = yield* FileSystem.FileSystem;

    const imageExists = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      const inspect = CP.make`image inspect ${handle.name}`.pipe(runtime);
      return yield* spawner.success(inspect).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });

    const removeImage = Effect.fn(function* (handle: Snapshot.Handle.Handle) {
      const rmi = CP.make`rmi ${handle.name}`.pipe(runtime);
      yield* spawner.string(rmi).pipe(Effect.ignore);
    });

    const aquireSnapshot = Effect.fn(
      function* ({ snapshot, cache }) {
        const handle = yield* Snapshot.Handle.make(snapshot);

        if (yield* imageExists(handle)) {
          return handle;
        }

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });

        const containerfile = yield* Snapshot.encode(snapshot);
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build =
          CP.make`build -f ${containerfilePath} -t ${handle.name} ${snapshot.context}`.pipe(
            runtime,
          );
        yield* spawner.success(build);

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(handle));
        }

        return handle;
      },
      (effect, { snapshot }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.build(snapshot))),
        ),
    ) satisfies Sandbox.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(
      function* ({ handle, context, instructions, cache }) {
        const derived = yield* Snapshot.Handle.derive({ handle, instructions });
        if (yield* imageExists(derived)) {
          return derived;
        }

        const containerfile = yield* Snapshot.encode({
          image: handle.name,
          instructions,
        });

        const containerfilePath = yield* fs.makeTempFile({
          prefix: "open-insight-",
          suffix: ".Containerfile",
        });
        yield* fs.writeFileString(containerfilePath, containerfile);

        const build = CP.make`build -f ${containerfilePath} -t ${derived.name} ${context}`.pipe(
          runtime,
        );
        yield* spawner.success(build);

        if (!cache) {
          yield* Effect.addFinalizer(() => removeImage(derived));
        }

        return derived;
      },
      (effect, { handle, instructions }) =>
        effect.pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(Sandbox.Error.snapshot(Snapshot.Error.derive(handle.name, instructions))),
        ),
    ) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(
      function* ({ handle, resources }) {
        const name = yield* Sandbox.makeName().pipe(
          Effect.mapError(Sandbox.Error.sandboxStart(handle.name)),
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
        yield* spawner.success(run).pipe(Effect.mapError(Sandbox.Error.sandboxStart(name)));

        yield* Effect.addFinalizer(() =>
          spawner.success(CP.make`rm --force ${name}`.pipe(runtime)).pipe(Effect.ignore),
        );

        const makeExecCommand = (
          { options: { env, cwd }, command, args }: CP.StandardCommand,
          input?: string,
        ) => {
          const execArgs: string[] = [];
          if (input !== undefined) {
            execArgs.push("-i");
          }

          for (const [key, value] of Object.entries(env ?? {})) {
            if (value !== undefined) {
              execArgs.push("-e", `${key}=${value}`);
            }
          }

          if (cwd !== undefined) {
            execArgs.push("-w", cwd);
          }

          execArgs.push(name, command, ...args);

          const execOptions =
            input === undefined
              ? {}
              : ({
                  stdin: {
                    stream: Stream.make(input).pipe(Stream.encodeText),
                  },
                } satisfies CP.CommandOptions);

          return CP.make("exec", execArgs, execOptions).pipe(runtime);
        };

        return {
          cmd: Effect.fn(
            function* (cmd: CP.StandardCommand, input?: string) {
              const execCommand = makeExecCommand(cmd, input);
              const handle = yield* spawner.spawn(execCommand);

              const decoder = new TextDecoder();
              const stdoutBytes = yield* Stream.mkUint8Array(handle.stdout);
              const stdout = decoder.decode(stdoutBytes);

              const stderrBytes = yield* Stream.mkUint8Array(handle.stderr);
              const stderr = decoder.decode(stderrBytes);

              const exitCode = yield* handle.exitCode;

              return { stdout, stderr, exitCode };
            },
            (effect, cmd) =>
              effect
                .pipe(Effect.scoped)
                .pipe(Effect.mapError(Sandbox.Error.sandboxExec(name, Bash.format(cmd)))),
          ),
          expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
            const matchesMapping = portMappings.some(
              (mapping) => mapping.sandboxPort === sandboxPort && mapping.hostPort === hostPort,
            );

            if (!matchesMapping) {
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

            return { hostUrl: `http://localhost:${hostPort}` };
          }),
          download: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make`cp ${name}:${sandboxPath} ${hostPath}`;
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
          }),
          upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
            const command = CP.make`cp ${hostPath} ${name}:${sandboxPath}`;
            yield* spawner
              .success(command.pipe(runtime))
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
          }),
          readFile: Effect.fn(function* ({ sandboxPath }) {
            const command = makeExecCommand(CP.make`cat ${sandboxPath}`);
            return yield* spawner
              .string(command)
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
          }),
          writeFile: Effect.fn(function* ({ sandboxPath, content }) {
            const command = makeExecCommand(CP.make`tee ${sandboxPath}`, content);
            yield* spawner
              .success(command)
              .pipe(Effect.mapError(Sandbox.Error.sandboxExec(handle.name, Bash.format(command))));
          }),
        } satisfies Sandbox.Sandbox;
      },
      (effect) =>
        effect.pipe(
          Effect.provideService(Spawn.SpawnService, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
        ),
    ) satisfies Sandbox.Provider["runSandbox"];

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
