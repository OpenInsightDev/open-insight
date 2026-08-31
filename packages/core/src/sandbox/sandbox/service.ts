import { Context, Effect, Layer } from "effect";
import * as Spawner from "#/spawn/index.ts";
import { makeScript, type TemplateExpression } from "#/utils/shell.ts";

export type Command = Readonly<{
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}>;

export type Handle = Spawner.ExecHandle;

export type Fn = (
  command: Command,
  options?: Spawner.Options,
) => Effect.Effect<Spawner.ExecHandle, Spawner.SpawnError>;

export type Spawn = Readonly<{
  spawn: Fn;

  exitCode(command: Command): Effect.Effect<number, Spawner.SpawnError>;

  success(command: Command): Effect.Effect<void, Spawner.SpawnError>;

  stdout(command: Command, options?: Spawner.Options): Effect.Effect<string, Spawner.SpawnError>;

  stderr(command: Command, options?: Spawner.Options): Effect.Effect<string, Spawner.SpawnError>;

  $: {
    (
      strings: TemplateStringsArray,
      ...values: ReadonlyArray<TemplateExpression>
    ): Effect.Effect<string, Spawner.SpawnError>;
    (
      options: Omit<Command, "command" | "args">,
    ): (
      strings: TemplateStringsArray,
      ...values: ReadonlyArray<TemplateExpression>
    ) => Effect.Effect<string, Spawner.SpawnError>;
  };
}>;

const isTemplateStringsArray = (
  value: TemplateStringsArray | Omit<Command, "command" | "args">,
): value is TemplateStringsArray => Array.isArray(value);

/**
 * Simpified `ChildProcessSpawner` for each sandbox provider to implement on how to spawn processes in their sandbox environment.
 */
export class Service extends Context.Service<Service, Spawn>()("SpawnService") {
  static layerFrom = (spawn: Fn) => {
    const stdout: Spawn["stdout"] = (command, options) =>
      spawn(command, options).pipe(Effect.map(({ stdout }) => stdout));

    function $(
      strings: TemplateStringsArray,
      ...values: ReadonlyArray<TemplateExpression>
    ): Effect.Effect<string, Spawner.SpawnError>;
    function $(
      options: Omit<Command, "command" | "args">,
    ): (
      strings: TemplateStringsArray,
      ...values: ReadonlyArray<TemplateExpression>
    ) => Effect.Effect<string, Spawner.SpawnError>;
    function $(
      first: TemplateStringsArray | Omit<Command, "command" | "args">,
      ...values: ReadonlyArray<TemplateExpression>
    ) {
      if (isTemplateStringsArray(first)) {
        return stdout({ command: "sh", args: ["-c", makeScript(first, values)] });
      }
      return (strings: TemplateStringsArray, ...innerValues: ReadonlyArray<TemplateExpression>) =>
        stdout({ command: "sh", args: ["-c", makeScript(strings, innerValues)], ...first });
    }

    return Layer.succeed(Service, {
      spawn,
      exitCode: (command) =>
        spawn(command, { errorOnNonZeroExit: false }).pipe(Effect.map(({ exitCode }) => exitCode)),
      success: (command) => spawn(command, { errorOnNonZeroExit: true }),
      stdout,
      stderr: (command, options) =>
        spawn(command, options).pipe(Effect.map(({ stderr }) => stderr)),
      $,
    } satisfies Service["Service"]);
  };
}
