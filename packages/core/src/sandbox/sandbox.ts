import { FileSystem } from "./fs.ts";
import { Process } from "./process.ts";
import { Context, Effect, Layer, Terminal } from "effect";

export class Sandbox extends Context.Service<
  Sandbox,
  {
    fs: FileSystem["Service"];
    process: Process["Service"];
    pty: Terminal.Terminal;
  }
>()("Sandbox") {}

export const layer = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const process = yield* Process;
    const pty = yield* Terminal.Terminal;
    return { fs, process, pty };
  }),
);
