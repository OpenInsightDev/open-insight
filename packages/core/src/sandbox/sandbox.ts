import * as Snapshot from "#/snapshot/index.ts";
import { FileSystem } from "./fs.ts";
import { Process } from "./process.ts";
import { Terminal } from "./terminal.ts";
import { Network } from "./network.ts";
import { Context, Effect, Layer } from "effect";

export class Sandbox extends Context.Service<
  Sandbox,
  {
    snapshot: Snapshot.Snapshot;
    fs: FileSystem["Service"];
    process: Process["Service"];
    pty: Terminal["Service"];
    network: Network["Service"];
  }
>()("Sandbox") {}

export const layerFrom = (snapshot: Snapshot.Snapshot) =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const process = yield* Process;
      const pty = yield* Terminal;
      const network = yield* Network;

      return { snapshot, fs, process, pty, network };
    }),
  );
