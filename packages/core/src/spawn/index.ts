import { Context, Effect, Layer, Scope, Stream } from "effect";
import type { Command } from "effect/unstable/process/ChildProcess";
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
} from "effect/unstable/process/ChildProcessSpawner";
import { SpawnError } from "./error.ts";

export type ExecHandle = Readonly<{
  exitCode: ExitCode;
  stdout: string;
  stderr: string;
}>;

const toExecHandle = Effect.fn(function* (handle: ChildProcessHandle) {
  const exitCode = yield* handle.exitCode.pipe(Effect.mapError(SpawnError.platform));

  const { stdout, stderr } = yield* Effect.all(
    {
      stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
      stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
    },
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(SpawnError.platform));

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
    ): Effect.Effect<ChildProcessHandle, SpawnError, Scope.Scope>;

    exec(command: Command, options?: Options): Effect.Effect<ExecHandle, SpawnError>;

    exitCode(command: Command): Effect.Effect<ExitCode, SpawnError>;

    success(command: Command): Effect.Effect<void, SpawnError>;

    streamString(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, SpawnError>;

    streamLines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Stream.Stream<string, SpawnError>;

    string(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<string, SpawnError>;

    lines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined } & Options,
    ): Effect.Effect<ReadonlyArray<string>, SpawnError>;
  }
>()("packages/core/spawn/SpawnService") {
  static readonly layer: Layer.Layer<Service, never, ChildProcessSpawner> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const spawn: Service["Service"]["spawn"] = Effect.fn(function* (
        command: Command,
        { errorOnNonZeroExit = true }: Options = {},
      ) {
        const handle = yield* spawner.spawn(command).pipe(Effect.mapError(SpawnError.platform));
        const exitCode = yield* handle.exitCode.pipe(Effect.mapError(SpawnError.platform));

        if (exitCode !== 0 && errorOnNonZeroExit) {
          const { stdout, stderr } = yield* toExecHandle(handle);
          return yield* Effect.fail(SpawnError.exit(exitCode, stdout, stderr));
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
            Effect.catchTag("SpawnError", (err) =>
              err.reason._tag === "NonZeroExit"
                ? Effect.succeed(err.reason.exitCode)
                : Effect.fail(err),
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
              Stream.mapError(SpawnError.platform),
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

export * from "./error.ts";
