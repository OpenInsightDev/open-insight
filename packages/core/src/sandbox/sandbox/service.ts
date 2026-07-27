import { Context, Effect, Layer } from "effect";
import { Spawn } from "#/utils/index.ts";

export type Command = Readonly<{
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}>;

export type Handle = Spawn.ExecHandle;

export type Fn = (
  command: Command,
  options?: Spawn.Options,
) => Effect.Effect<Spawn.ExecHandle, Spawn.Error>;

export type Spawn = Readonly<{
  spawn: Fn;

  exitCode(command: Command): Effect.Effect<number, Spawn.Error>;

  success(command: Command): Effect.Effect<void, Spawn.Error>;

  stdout(command: Command, options?: Spawn.Options): Effect.Effect<string, Spawn.Error>;

  stderr(command: Command, options?: Spawn.Options): Effect.Effect<string, Spawn.Error>;
}>;

/**
 * Simpified `ChildProcessSpawner` for each sandbox provider to implement on how to spawn processes in their sandbox environment.
 */
export class Service extends Context.Service<Service, Spawn>()("SpawnService") {
  static layerFrom = (spawn: Fn) =>
    Layer.succeed(Service, {
      spawn,
      exitCode: (command) =>
        spawn(command, { errorOnNonZeroExit: false }).pipe(Effect.map(({ exitCode }) => exitCode)),
      success: (command) => spawn(command, { errorOnNonZeroExit: true }),
      stdout: (command, options) =>
        spawn(command, options).pipe(Effect.map(({ stdout }) => stdout)),
      stderr: (command, options) =>
        spawn(command, options).pipe(Effect.map(({ stderr }) => stderr)),
    } satisfies Service["Service"]);
}
