import { Context, Data, Effect, Layer, PlatformError, Scope, Stream } from "effect";
import type { Command } from "effect/unstable/process/ChildProcess";
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
} from "effect/unstable/process/ChildProcessSpawner";

export class SpawnExitCodeError extends Data.TaggedError("SpawnExitCodeError")<{
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `process exited with code ${this.exitCode}`;
  }
}

export type SpawnErrorReason = PlatformError.PlatformError | SpawnExitCodeError;

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly reason: SpawnErrorReason;
}> {
  override get message(): string {
    return this.reason.message;
  }

  static platform = (err: PlatformError.PlatformError) => new SpawnError({ reason: err });

  static exit = ({
    exitCode,
    stdout,
    stderr,
  }: {
    exitCode: ExitCode;
    stdout: string;
    stderr: string;
  }) =>
    new SpawnError({
      reason: new SpawnExitCodeError({ exitCode, stdout, stderr }),
    });
}

export interface Options {
  readonly throwOnNonZeroExit?: boolean;
}

export class SpawnService extends Context.Service<
  SpawnService,
  {
    spawn(
      command: Command,
      options?: Options,
    ): Effect.Effect<ChildProcessHandle, SpawnError, Scope.Scope>;

    exitCode(command: Command): Effect.Effect<ExitCode, PlatformError.PlatformError>;

    success(command: Command): Effect.Effect<void, SpawnError>;

    streamString(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined },
    ): Stream.Stream<string, SpawnError>;

    streamLines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined },
    ): Stream.Stream<string, SpawnError>;

    string(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined },
    ): Effect.Effect<string, SpawnError>;

    lines(
      command: Command,
      options?: { readonly includeStderr?: boolean | undefined },
    ): Effect.Effect<ReadonlyArray<string>, SpawnError>;
  }
>()("packages/core/utils/SpawnService") {
  static readonly layer: Layer.Layer<SpawnService, never, ChildProcessSpawner> = Layer.effect(
    SpawnService,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const streamText = (stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
        Stream.mkString(Stream.decodeText(stream));

      const spawn: SpawnService["Service"]["spawn"] = Effect.fn(function* (
        command: Command,
        options?: Options,
      ) {
        const handle = yield* spawner.spawn(command).pipe(Effect.mapError(SpawnError.platform));

        const exitCode = yield* handle.exitCode.pipe(Effect.mapError(SpawnError.platform));

        if (exitCode !== 0 && options?.throwOnNonZeroExit !== false) {
          const { stdout, stderr } = yield* Effect.all(
            {
              stdout: streamText(handle.stdout),
              stderr: streamText(handle.stderr),
            },
            { concurrency: "unbounded" },
          ).pipe(Effect.mapError(SpawnError.platform));

          return yield* SpawnError.exit({ exitCode, stdout, stderr });
        }

        return handle;
      });

      const streamString: SpawnService["Service"]["streamString"] = (
        command: Command,
        options?: { readonly includeStderr?: boolean | undefined },
      ) =>
        spawn(command).pipe(
          Effect.map((handle) =>
            Stream.decodeText(options?.includeStderr === true ? handle.all : handle.stdout).pipe(
              Stream.mapError(SpawnError.platform),
            ),
          ),
          Stream.unwrap,
        );

      const streamLines: SpawnService["Service"]["streamLines"] = (
        command: Command,
        options?: { readonly includeStderr?: boolean | undefined },
      ) => Stream.splitLines(streamString(command, options));

      const exitCode: SpawnService["Service"]["exitCode"] = (command: Command) =>
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(command);
          return yield* handle.exitCode;
        }).pipe(Effect.scoped);

      const success: SpawnService["Service"]["success"] = (command: Command) =>
        spawn(command).pipe(Effect.scoped, Effect.asVoid);

      const string: SpawnService["Service"]["string"] = (
        command: Command,
        options?: { readonly includeStderr?: boolean | undefined },
      ) => Stream.mkString(streamString(command, options));

      const lines: SpawnService["Service"]["lines"] = (
        command: Command,
        options?: { readonly includeStderr?: boolean | undefined },
      ) => Stream.runCollect(streamLines(command, options));

      return {
        spawn,
        exitCode,
        success,
        streamString,
        streamLines,
        lines,
        string,
      } satisfies SpawnService["Service"];
    }),
  );
}
