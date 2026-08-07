import type { CommandResult, RunCommandOptions, SandboxFileSystem } from "computesdk";
import { Effect, FileSystem, PlatformError } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { ExitCode } from "effect/unstable/process/ChildProcessSpawner";
import { Bash, Sandbox, SandboxError, Spawn } from "@open-insight/core";

export interface ComputeSandbox {
  /** Unique identifier for the sandbox */
  readonly sandboxId: string;

  /** Provider name (e2b, railway, modal, etc.) */
  readonly provider: string;

  /**
   * Execute shell command
   *
   * Send raw command string to the sandbox - no preprocessing.
   * The provider/server handles shell invocation and execution details.
   */
  runCommand(command: string, options?: RunCommandOptions): Promise<CommandResult>;

  /** Get URL for accessing the sandbox on a specific port */
  getUrl(options: { port: number; protocol?: string }): Promise<string>;

  /** Destroy the sandbox and clean up resources */
  destroy(): Promise<void>;

  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}

export const toSandbox = Effect.fn(function* (
  sandbox: ComputeSandbox,
): Effect.fn.Return<Sandbox.Sandbox, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const name = sandbox.sandboxId;

  const spawn = Effect.fn(function* (command: Sandbox.Spawn.Command, options?: Spawn.Options) {
    const runOptions: RunCommandOptions = {
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
      ...(command.env === undefined ? {} : { env: command.env }),
    };

    const result: CommandResult = yield* Effect.tryPromise({
      try: () =>
        sandbox.runCommand(Bash.format(CP.make(command.command, command.args ?? [])), runOptions),
      catch: (cause) =>
        Spawn.Error.platform(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "computesdk",
            method: "runCommand",
            cause,
          }),
        ),
    });

    const handle = {
      exitCode: ExitCode(result.exitCode),
      stdout: result.stdout,
      stderr: result.stderr,
    };

    if (handle.exitCode !== 0 && options?.errorOnNonZeroExit !== false) {
      return yield* Effect.fail(Spawn.Error.exit(handle.exitCode, handle.stdout, handle.stderr));
    }

    return handle;
  });

  const spawner: Sandbox.Spawn.Spawn = {
    spawn,
    exitCode: (command) =>
      spawn(command, { errorOnNonZeroExit: false }).pipe(Effect.map(({ exitCode }) => exitCode)),
    success: (command) => spawn(command, { errorOnNonZeroExit: true }),
    stdout: (command, options) => spawn(command, options).pipe(Effect.map(({ stdout }) => stdout)),
    stderr: (command, options) => spawn(command, options).pipe(Effect.map(({ stderr }) => stderr)),
  };

  return {
    ...spawner,
    cmd: Effect.fn(function* (process: Sandbox.Spawn.Command) {
      return yield* spawn(process).pipe(
        Effect.mapError(
          SandboxError.sandboxExec(name, Bash.format(CP.make(process.command, process.args ?? []))),
        ),
      );
    }),
    readFile: Effect.fn(function* ({ sandboxPath }) {
      return yield* Effect.tryPromise({
        try: () => sandbox.filesystem.readFile(sandboxPath),
        catch: SandboxError.sandboxExec(name, `read ${Bash.quote(sandboxPath)}`),
      });
    }),
    writeFile: Effect.fn(function* ({ sandboxPath, content }) {
      yield* Effect.tryPromise({
        try: () => sandbox.filesystem.writeFile(sandboxPath, content),
        catch: SandboxError.sandboxExec(name, `write ${Bash.quote(sandboxPath)}`),
      });
    }),
    download: Effect.fn(function* ({ sandboxPath, hostPath }) {
      const content = yield* Effect.tryPromise({
        try: () => sandbox.filesystem.readFile(sandboxPath),
        catch: SandboxError.sandboxExec(name, `download ${Bash.quote(sandboxPath)}`),
      });
      yield* fs
        .writeFileString(hostPath, content)
        .pipe(
          Effect.mapError(SandboxError.sandboxExec(name, `download ${Bash.quote(sandboxPath)}`)),
        );
    }),
    upload: Effect.fn(function* ({ sandboxPath, hostPath }) {
      const content = yield* fs
        .readFileString(hostPath)
        .pipe(Effect.mapError(SandboxError.sandboxExec(name, `upload ${Bash.quote(hostPath)}`)));
      yield* Effect.tryPromise({
        try: () => sandbox.filesystem.writeFile(sandboxPath, content),
        catch: SandboxError.sandboxExec(name, `upload ${Bash.quote(sandboxPath)}`),
      });
    }),
    expose: Effect.fn(function* ({ sandboxPort }) {
      const hostUrl = yield* Effect.tryPromise({
        try: () => sandbox.getUrl({ port: sandboxPort }),
        catch: SandboxError.sandboxExpose(name, sandboxPort),
      });
      return { hostUrl };
    }),
  } satisfies Sandbox.Sandbox;
});
