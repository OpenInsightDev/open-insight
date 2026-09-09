import { Cause, Context, Effect, Layer, Queue, Scope, Terminal as EffectTerminal } from "effect";
import { FileSystem } from "./fs.ts";
import { Process } from "./process.ts";
import { SandboxError } from "./error.ts";

export class Terminal extends Context.Service<
  Terminal,
  {
    readonly columns: Effect.Effect<number>;
    readonly rows: Effect.Effect<number>;
    readonly readInput: Effect.Effect<Queue.Dequeue<UserInput, Cause.Done>, never, Scope.Scope>;
    readonly readLine: Effect.Effect<string, QuitError>;
    readonly display: (text: string) => Effect.Effect<void, SandboxError>;
  }
>()("open-insight/sandbox/Terminal") {
  static make = (service: TerminalService): TerminalService => service;
}

export namespace Terminal {
  export type UserInput = EffectTerminal.UserInput;
  export const QuitError = EffectTerminal.QuitError;
}

export type TerminalService = Terminal["Service"];

export type UserInput = Terminal.UserInput;
export type QuitError = EffectTerminal.QuitError;

export class Sandbox extends Context.Service<
  Sandbox,
  {
    fs: FileSystem["Service"];
    process: Process["Service"];
    pty: TerminalService;
  }
>()("Sandbox") {}

export const layer = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const process = yield* Process;
    const pty = yield* Terminal;
    return { fs, process, pty };
  }),
);
