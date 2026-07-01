import { Spawn } from "@open-insight/utils";
import { Sandbox } from "@open-insight/core/internal";
import { Context, Crypto, Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
}>;

const PROVIDER_NAME = "apple-container";

export const make = Effect.fn(
  function* ({
    portMappings = [],
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.SandboxError,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.SpawnService
  > {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.SpawnService;
    const fs = yield* FileSystem.FileSystem;

    const ensureSnapshot = Effect.fn(function* (options) {
      const { snapshot, context } = options;
      const mapBuildError = Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot));

      const name = yield* Sandbox.Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapBuildError,
      );

      const containerfilePath = yield* fs
        .makeTempFile({
          prefix: "sandbox-apple-container-",
          suffix: ".Dockerfile",
        })
        .pipe(mapBuildError);

      const command = CP.make`container build -f ${containerfilePath} -t ${name} ${context}`;

      const containerfile = yield* Sandbox.Snapshot.encode(snapshot).pipe(mapBuildError);
      yield* fs.writeFileString(containerfilePath, containerfile).pipe(mapBuildError);

      yield* spawner.string(command).pipe(mapBuildError);
    }) satisfies Sandbox.Provider["ensureSnapshot"];

    const removeSnapshot = Effect.fn(function* ({ snapshot }) {
      const mapBuildError = Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot));

      const name = yield* Sandbox.Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        mapBuildError,
      );

      const command = CP.make`container image rm --force ${name}`;

      yield* spawner.string(command).pipe(mapBuildError);
    }) satisfies Sandbox.Provider["removeSnapshot"];

    const deriveSnapshot = Effect.fn(function* (
      options: Parameters<Sandbox.Provider["deriveSnapshot"]>[0],
    ) {
      const { snapshot, context, instructions } = options;
      yield* ensureSnapshot({ snapshot, context });

      const name = yield* Sandbox.Snapshot.makeName(snapshot).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
      );
      const derived = Sandbox.Snapshot.Snapshot.make({ image: name, instructions });
      yield* ensureSnapshot({ snapshot: derived, context });
    }) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(function* ({ snapshot, resources: _resources }) {
      const mapUsageError = Effect.mapError(Sandbox.SandboxError.snapshotUsage(snapshot));

      const name = yield* Sandbox.Snapshot.makeName(snapshot).pipe(
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
        name,
        "sleep",
        "infinity",
      ]);

      yield* spawner
        .string(run)
        .pipe(Effect.mapError(Sandbox.SandboxError.provider(PROVIDER_NAME)));

      yield* Effect.addFinalizer(() =>
        spawner.string(CP.make`container rm --force ${sandboxName}`).pipe(Effect.ignore),
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

        return CP.make("exec", args, options);
      };

      return yield* Sandbox.make({
        $(cmd: CP.StandardCommand, input?: string) {
          const bash = Sandbox.formatBash(cmd);
          const execCommand = makeExecCommand(cmd, input);
          return spawner
            .string(execCommand)
            .pipe(Effect.mapError(Sandbox.SandboxError.sandboxExec({ name, operation: bash })));
        },
        expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
          const matchesMapping = portMappings.some(
            (mapping) => mapping.sandboxPort === sandboxPort && mapping.hostPort === hostPort,
          );

          if (!matchesMapping) {
            return yield* Effect.fail(
              Sandbox.SandboxError.sandboxExpose({ name, sandboxPort, hostPort })(
                "Expected port mapping cannot be exposed because it was not specified in the configuration. Apple container publishes ports when the container is created.",
              ),
            );
          }

          return { hostUrl: `http://localhost:${hostPort}` };
        }),
        download: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const from = `${sandboxName}:${sandboxPath}`;
          const command = CP.make`container cp ${from} ${hostPath}`;
          yield* spawner.string(command).pipe(
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name,
                operation: Sandbox.formatBash(command),
              }),
            ),
          );
        }),
        upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const to = `${sandboxName}:${sandboxPath}`;
          const command = CP.make`container cp ${hostPath} ${to}`;
          yield* spawner.string(command).pipe(
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name,
                operation: Sandbox.formatBash(command),
              }),
            ),
          );
        }),
        readFile: "cat",
        writeFile: "tee",
      }).pipe(Effect.provideService(Spawn.SpawnService, spawner));
    }) satisfies Sandbox.Provider["runSandbox"];

    return {
      ensureSnapshot,
      deriveSnapshot,
      removeSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
