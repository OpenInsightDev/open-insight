import { Context, Data, Effect, Layer, PlatformError, Scope, Stream } from "effect";
import type { Command } from "effect/unstable/process/ChildProcess";
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
} from "effect/unstable/process/ChildProcessSpawner";

export class NonZeroExit extends Data.TaggedError("SpawnExitCodeError")<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `process exited with code ${this.exitCode}`;
  }
}

export type ErrorReason = PlatformError.PlatformError | NonZeroExit;

export class Error extends Data.TaggedError("SpawnError")<{
  readonly reason: ErrorReason;
}> {
  override get message(): string {
    return this.reason.message;
  }

  static platform = (reason: PlatformError.PlatformError) => new Error({ reason });

  static exit = (exitCode: ExitCode, stdout: string, stderr: string) =>
    new Error({
      reason: new NonZeroExit({ exitCode, stdout, stderr }),
    });
}

export type ExecHandle = Readonly<{
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}>;

const toExecHandle = Effect.fn(function* (handle: ChildProcessHandle) {
  const exitCode = yield* handle.exitCode.pipe(Effect.mapError(Error.platform));

  const { stdout, stderr } = yield* Effect.all(
    {
      stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
      stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
    },
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(Error.platform));

  return {
    exitCode,
    stdout,
    stderr,
  } satisfies ExecHandle;
});

export type Options = Readonly<{
  /**
   * Whether to throw an error if the spawned process exits with a non-zero exit code.
   * Default is true.
   */
  readonly errorOnNonZeroExit?: boolean;
}>;

/**
 * `ChildProcessSpawner` with additional options to throw an error if the spawned process exits with a non-zero exit code.
 */
export class Service extends Context.Service<
  Service,
  {
    spawn(
      command: Command,
      options?: Options,
    ): Effect.Effect<ChildProcessHandle, Error, Scope.Scope>;

    exec(command: Command, options?: Options): Effect.Effect<ExecHandle, Error>;

    exitCode(command: Command): Effect.Effect<ExitCode, Error>;

    success(command: Command): Effect.Effect<void, Error>;

    streamString(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, Error>;

    streamLines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, Error>;

    string(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<string, Error>;

    lines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<ReadonlyArray<string>, Error>;
  }
>()("packages/core/utils/SpawnService") {
  static readonly layer: Layer.Layer<Service, never, ChildProcessSpawner> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const spawn: Service["Service"]["spawn"] = Effect.fn(function* (
        command: Command,
        { errorOnNonZeroExit = true }: Options = {},
      ) {
        const handle = yield* spawner.spawn(command).pipe(Effect.mapError(Error.platform));
        const exitCode = yield* handle.exitCode.pipe(Effect.mapError(Error.platform));

        if (exitCode !== 0 && errorOnNonZeroExit) {
          const { stdout, stderr } = yield* toExecHandle(handle);
          return yield* Effect.fail(Error.exit(exitCode, stdout, stderr));
        }

        return handle;
      });

      const exec: Service["Service"]["exec"] = Effect.fn(
        function* (command: Command, options?: Options) {
          const handle = yield* spawn(command, options);
          return yield* toExecHandle(handle);
        },
        (effect) => effect.pipe(Effect.scoped),
      );

      const exitCode: Service["Service"]["exitCode"] = (command) =>
        spawn(command)
          .pipe(
            Effect.catchReason("SpawnError", "SpawnExitCodeError", (err) =>
              Effect.succeed(err.exitCode),
            ),
            Effect.map(() => ExitCode(0)),
          )
          .pipe(Effect.scoped);

      const success: Service["Service"]["success"] = (command) =>
        spawn(command).pipe(Effect.scoped, Effect.asVoid);

      const string: Service["Service"]["string"] = (command, options = {}) =>
        Stream.mkString(streamString(command, options));

      const lines: Service["Service"]["lines"] = (command, options = {}) =>
        Stream.runCollect(streamLines(command, options));

      const streamString: Service["Service"]["streamString"] = (
        command,
        { includeStderr, ...options } = {},
      ) =>
        spawn(command, options).pipe(
          Effect.map((handle) =>
            Stream.decodeText(includeStderr === true ? handle.all : handle.stdout).pipe(
              Stream.mapError(Error.platform),
            ),
          ),
          Stream.unwrap,
        );

      const streamLines: Service["Service"]["streamLines"] = (command, options) =>
        Stream.splitLines(streamString(command, options));

      return {
        spawn,
        exitCode,
        exec,
        success,
        streamString,
        streamLines,
        lines,
        string,
      } satisfies Service["Service"];
    }),
  );
}
