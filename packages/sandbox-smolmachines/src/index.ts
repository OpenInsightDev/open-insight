import { Sandbox } from "@open-insight/core";
import { Spawn } from "@open-insight/core/utils";
import { Crypto, Effect, FileSystem, Option, Path, Schema, type Scope } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { Machine, type ExecOptions, type PortSpec, type ResourceSpec } from "smolmachines";

export type PortMapping = Readonly<{
  sandboxPort: number;
  hostPort: number;
}>;

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
}>;

const SnapshotState = Schema.Struct({
  env: Schema.Record(Schema.String, Schema.String),
  workdir: Schema.UndefinedOr(Schema.String),
});
type SnapshotState = Schema.Schema.Type<typeof SnapshotState>;

type SnapshotMachine = Readonly<{
  machine: Machine;
  state: SnapshotState;
}>;

const initialState: SnapshotState = {
  env: {},
  workdir: undefined,
};

const metadataPath = "/open-insight/snapshot.json";

const formatResources = (resources: Sandbox.ResourceLimits | null): ResourceSpec => {
  const spec: ResourceSpec = {};

  if (resources?.internet !== undefined) {
    spec.network = resources.internet;
  }

  if (resources?.numCPUs !== undefined) {
    spec.cpus = resources.numCPUs;
  }

  if (resources?.memoryMiB !== undefined) {
    spec.memoryMb = resources.memoryMiB;
  }

  if (resources?.storageMiB !== undefined) {
    spec.storageGb = Math.ceil(resources.storageMiB / 1024);
  }

  if (resources?.numGPUs !== undefined && resources.numGPUs > 0) {
    spec.gpu = true;
  }

  return spec;
};

const formatPorts = (portMappings: ReadonlyArray<PortMapping>): Array<PortSpec> =>
  portMappings.map((mapping) => ({
    host: mapping.hostPort,
    guest: mapping.sandboxPort,
  }));

const guestDirname = (filePath: string) => {
  const parts = filePath.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return filePath.startsWith("/") ? "/" : ".";
  }
  const directory = parts.slice(0, -1).join("/");
  return filePath.startsWith("/") ? `/${directory}` : directory;
};

const guestJoin = (directory: string, file: string) =>
  `${directory.replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`;

const makeExecOptions = (command: CP.StandardCommand | undefined, state: SnapshotState) => {
  const env: Record<string, string> = { ...state.env };
  for (const [key, value] of Object.entries(command?.options.env ?? {})) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const options: ExecOptions = {};
  if (Object.keys(env).length > 0) {
    options.env = env;
  }

  const workdir = command?.options.cwd ?? state.workdir;
  if (workdir !== undefined) {
    options.workdir = workdir;
  }

  return options;
};

export const make = Effect.fn("sandbox/provider/smolmachines")(
  function* ({
    portMappings = [],
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.SandboxError,
    Crypto.Crypto | FileSystem.FileSystem | Path.Path | Spawn.SpawnService
  > {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* Spawn.SpawnService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const ports = formatPorts(portMappings);
    const snapshotMachines = new Map<string, SnapshotMachine>();

    const run = (
      machine: Machine,
      command: ReadonlyArray<string>,
      options: ExecOptions | undefined,
    ) =>
      Effect.tryPromise(async () => {
        const result = await machine.exec(Array.from(command), options);
        result.assertSuccess();
        return result;
      });

    const removeMachine = (machine: Machine) =>
      Effect.tryPromise({
        try: () => machine.delete(),
        catch: () => undefined,
      }).pipe(Effect.ignore);

    const stopMachine = (machine: Machine) =>
      Effect.tryPromise({
        try: () => machine.stop(),
        catch: () => undefined,
      }).pipe(Effect.ignore);

    const readState = (machine: Machine): Effect.Effect<SnapshotState> =>
      Effect.tryPromise({
        try: () => machine.readFile(metadataPath),
        catch: () => undefined,
      }).pipe(
        Effect.flatMap((content) =>
          content === undefined
            ? Effect.succeed(initialState)
            : Effect.try({
                try: () => JSON.parse(content.toString("utf8")),
                catch: () => initialState,
              }),
        ),
        Effect.flatMap(Schema.decodeUnknownEffect(SnapshotState)),
        Effect.catch(() => Effect.succeed(initialState)),
      );

    const writeState = (machine: Machine, state: SnapshotState) =>
      Effect.gen(function* () {
        yield* run(machine, ["mkdir", "-p", guestDirname(metadataPath)], undefined);
        yield* Effect.tryPromise(() =>
          machine.writeFile(metadataPath, `${JSON.stringify(state)}\n`),
        );
      });

    const upload = (
      machine: Machine,
      hostPath: string,
      sandboxPath: string,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const info = yield* fs.stat(hostPath);
        if (info.type === "Directory") {
          yield* run(machine, ["mkdir", "-p", sandboxPath], undefined).pipe(Effect.asVoid);

          const entries = yield* fs.readDirectory(hostPath);
          for (const entry of entries) {
            yield* upload(machine, path.join(hostPath, entry), guestJoin(sandboxPath, entry));
          }
          return;
        }

        yield* run(machine, ["mkdir", "-p", guestDirname(sandboxPath)], undefined).pipe(
          Effect.asVoid,
        );

        const content = yield* fs.readFile(hostPath);
        yield* Effect.tryPromise(() => machine.writeFile(sandboxPath, content));
      });

    const applyInstructions = (
      machine: Machine,
      snapshot: Sandbox.Snapshot.Snapshot,
      context: Sandbox.Context.Context,
      instructions: Sandbox.Snapshot.Instructions,
      state: SnapshotState,
    ) =>
      Effect.gen(function* () {
        let nextState = state;

        for (const instruction of instructions) {
          yield* Sandbox.Snapshot.Inst.Instruction.match(instruction, {
            Workdir: ({ path: workdir }) =>
              Effect.gen(function* () {
                yield* run(machine, ["mkdir", "-p", workdir], undefined).pipe(
                  Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
                );
                nextState = { ...nextState, workdir };
              }),
            Env: ({ env }) =>
              Effect.sync(() => {
                nextState = { ...nextState, env: { ...nextState.env, ...env } };
              }),
            Run: ({ cmd }) =>
              run(machine, ["sh", "-c", cmd], makeExecOptions(undefined, nextState)).pipe(
                Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
              ),
            Copy: ({ src, dest }) =>
              Effect.gen(function* () {
                for (const source of src) {
                  const hostPath = path.resolve(context, source);
                  const sandboxPath =
                    src.length > 1 || dest.endsWith("/")
                      ? guestJoin(dest, path.basename(source))
                      : dest;
                  yield* upload(machine, hostPath, sandboxPath).pipe(
                    Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
                  );
                }
              }),
            User: () =>
              Effect.fail(
                Sandbox.SandboxError.instructionUnsupported("smolmachines", snapshot, instruction),
              ),
            Cmd: () =>
              Effect.fail(
                Sandbox.SandboxError.instructionUnsupported("smolmachines", snapshot, instruction),
              ),
            Entrypoint: () =>
              Effect.fail(
                Sandbox.SandboxError.instructionUnsupported("smolmachines", snapshot, instruction),
              ),
          });
        }

        yield* writeState(machine, nextState).pipe(
          Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
        );
        return nextState;
      });

    const acquireMachine = Effect.fn(function* (handle: Sandbox.Snapshot.Handle.Handle) {
      const cached = snapshotMachines.get(handle.name);
      if (cached !== undefined) {
        return cached;
      }

      const machine = yield* Effect.tryPromise(() =>
        Machine.connect(handle.name, { target: "local" }),
      ).pipe(
        Effect.mapError(
          Sandbox.SandboxError.snapshotUsage(Sandbox.Snapshot.fromImage(handle.name)),
        ),
      );
      const state = yield* readState(machine);
      const entry = { machine, state } satisfies SnapshotMachine;
      snapshotMachines.set(handle.name, entry);
      return entry;
    });

    const registerMachine = Effect.fn(function* ({
      handle,
      machine,
      state,
      cache,
    }: {
      handle: Sandbox.Snapshot.Handle.Handle;
      machine: Machine;
      state: SnapshotState;
      cache: boolean;
    }): Effect.fn.Return<void, never, Scope.Scope> {
      snapshotMachines.set(handle.name, { machine, state });

      const cleanup = cache ? stopMachine(machine) : removeMachine(machine);
      yield* Effect.addFinalizer(() =>
        cleanup.pipe(Effect.andThen(Effect.sync(() => snapshotMachines.delete(handle.name)))),
      );
    });

    const aquireSnapshot = Effect.fn(
      function* ({ snapshot, context, cache = true }) {
        const handle = yield* Sandbox.Snapshot.Handle.make(snapshot, { format: "pascal" }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
        );

        const existing = yield* Effect.tryPromise({
          try: () => Machine.connect(handle.name, { target: "local" }),
          catch: () => undefined,
        }).pipe(Effect.option);

        return yield* Option.match(existing, {
          onSome: (machine) =>
            Effect.gen(function* () {
              const state = yield* readState(machine);
              yield* registerMachine({ handle, machine, state, cache });
              return handle;
            }),
          onNone: () =>
            Effect.gen(function* () {
              const machine = yield* Effect.tryPromise(() =>
                Machine.create({
                  name: handle.name,
                  image: snapshot.image,
                  forkable: true,
                  persistent: true,
                  resources: formatResources(null),
                }),
              ).pipe(Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)));

              const state = yield* applyInstructions(
                machine,
                snapshot,
                context,
                snapshot.instructions,
                initialState,
              );

              yield* registerMachine({ handle, machine, state, cache });
              return handle;
            }),
        });
      },
      (effect, { snapshot }) =>
        effect.pipe(Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot))),
    ) satisfies Sandbox.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(function* ({ handle, instructions, context, cache = true }) {
      const base = yield* acquireMachine(handle);
      const derived = yield* Sandbox.Snapshot.Handle.derive({
        handle,
        instructions,
        format: "pascal",
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(
          Sandbox.SandboxError.snapshotBuild(Sandbox.Snapshot.fromImage(handle.name)),
        ),
      );

      const existing = snapshotMachines.get(derived.name);
      if (existing !== undefined) {
        return derived;
      }

      const persisted = yield* Effect.tryPromise({
        try: () => Machine.connect(derived.name, { target: "local" }),
        catch: () => undefined,
      }).pipe(Effect.option);

      return yield* Option.match(persisted, {
        onSome: (machine) =>
          Effect.gen(function* () {
            const state = yield* readState(machine);
            yield* registerMachine({ handle: derived, machine, state, cache });
            return derived;
          }),
        onNone: () =>
          Effect.gen(function* () {
            const snapshot = Sandbox.Snapshot.make({ image: handle.name, instructions });
            const machine = yield* Effect.tryPromise(() => base.machine.fork(derived.name)).pipe(
              Effect.mapError(Sandbox.SandboxError.snapshotBuild(snapshot)),
            );
            const state = yield* applyInstructions(
              machine,
              snapshot,
              context,
              instructions,
              base.state,
            );

            yield* registerMachine({ handle: derived, machine, state, cache });
            return derived;
          }),
      });
    }) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(function* ({ handle, resources }) {
      if (resources !== null) {
        return yield* Effect.fail(
          Sandbox.SandboxError.sandboxStart(handle.name)(
            "The local smolmachines fork API does not support overriding resources for forked sandboxes.",
          ),
        );
      }

      const base = yield* acquireMachine(handle).pipe(
        Effect.mapError(Sandbox.SandboxError.sandboxStart(handle.name)),
      );
      const name = yield* Sandbox.makeName().pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.mapError(Sandbox.SandboxError.sandboxStart(handle.name)),
      );
      const machine = yield* Effect.tryPromise(() => base.machine.fork(name, ports)).pipe(
        Effect.mapError(Sandbox.SandboxError.sandboxStart(handle.name)),
      );

      yield* Effect.addFinalizer(() => removeMachine(machine));

      const sandboxExec = Effect.fn(function* (
        command: CP.StandardCommand,
        input?: string,
      ): Effect.fn.Return<string, Sandbox.SandboxError> {
        const bash = Sandbox.formatBash(command);
        const mapError = Sandbox.SandboxError.sandboxExec({
          name: handle.name,
          operation: bash,
        });
        const options = makeExecOptions(command, base.state);

        if (input === undefined) {
          const result = yield* run(machine, ["sh", "-c", bash], options).pipe(
            Effect.mapError(mapError),
          );
          return result.stdout;
        }

        const uuid = yield* crypto.randomUUIDv4.pipe(Effect.mapError(mapError));
        const stdinPath = `/tmp/open-insight-stdin-${uuid}`;
        yield* Effect.tryPromise(() => machine.writeFile(stdinPath, input)).pipe(
          Effect.mapError(mapError),
        );
        const result = yield* run(machine, ["sh", "-c", `${bash} < ${stdinPath}`], options).pipe(
          Effect.mapError(mapError),
          Effect.ensuring(
            run(machine, ["rm", "-f", stdinPath], undefined).pipe(
              Effect.mapError(mapError),
              Effect.ignore,
            ),
          ),
        );
        return result.stdout;
      });

      return yield* Sandbox.make({
        $: sandboxExec,
        expose: Effect.fn(function* ({ sandboxPort, hostPort }) {
          const matchesMapping = portMappings.some(
            (mapping) => mapping.sandboxPort === sandboxPort && mapping.hostPort === hostPort,
          );

          if (!matchesMapping) {
            return yield* Effect.fail(
              Sandbox.SandboxError.sandboxExpose({ name: handle.name, sandboxPort, hostPort })(
                "Expected port mapping cannot be exposed because it was not specified in the configuration.",
              ),
            );
          }

          return { hostUrl: `http://localhost:${hostPort}` };
        }),
        download: Effect.fn(function* ({ sandboxPath, hostPath }) {
          const operation = `download ${sandboxPath} -> ${hostPath}`;
          const content = yield* Effect.tryPromise(() => machine.readFile(sandboxPath)).pipe(
            Effect.mapError(Sandbox.SandboxError.sandboxExec({ name: handle.name, operation })),
          );
          yield* fs
            .makeDirectory(path.dirname(hostPath), { recursive: true })
            .pipe(
              Effect.andThen(fs.writeFile(hostPath, content)),
              Effect.mapError(Sandbox.SandboxError.sandboxExec({ name: "host", operation })),
            );
        }),
        upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
          yield* upload(machine, hostPath, sandboxPath).pipe(
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name: handle.name,
                operation: `upload ${hostPath} -> ${sandboxPath}`,
              }),
            ),
          );
        }),
        readFile: Effect.fn(function* ({ sandboxPath }) {
          const content = yield* Effect.tryPromise(() => machine.readFile(sandboxPath)).pipe(
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name: handle.name,
                operation: `read ${sandboxPath}`,
              }),
            ),
          );
          return content.toString("utf8");
        }),
        writeFile: Effect.fn(function* ({ sandboxPath, content }) {
          yield* run(machine, ["mkdir", "-p", guestDirname(sandboxPath)], undefined).pipe(
            Effect.asVoid,
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name: handle.name,
                operation: `mkdir -p ${guestDirname(sandboxPath)}`,
              }),
            ),
          );
          yield* Effect.tryPromise(() => machine.writeFile(sandboxPath, content)).pipe(
            Effect.mapError(
              Sandbox.SandboxError.sandboxExec({
                name: handle.name,
                operation: `write ${sandboxPath}`,
              }),
            ),
          );
        }),
      }).pipe(Effect.provideService(Spawn.SpawnService, spawner));
    }) satisfies Sandbox.Provider["runSandbox"];

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.SpawnService.layer)),
);
