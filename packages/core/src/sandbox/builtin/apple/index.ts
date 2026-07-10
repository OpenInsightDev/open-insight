import { Sandbox } from "@open-insight/core";
import { Spawn } from "@open-insight/core/utils";
import { Crypto, Duration, Effect, FileSystem } from "effect";
import * as Image from "./image.ts";
import * as AppleSandbox from "./sandbox.ts";
import type { PortMapping } from "./utils.ts";

export type { PortMapping };

export type MakeOptions = Readonly<{
  portMappings?: Array<PortMapping>;
  timeout?: Duration.Input;
}>;

export const make = Effect.fn("sandbox/provider/apple")(
  function* ({
    portMappings = [],
    timeout = Duration.seconds(30),
  }: MakeOptions): Effect.fn.Return<
    Sandbox.Provider,
    Sandbox.Error,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.Service
  > {
    const crypto = yield* Crypto.Crypto;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.Service;

    yield* Image.startBuilder().pipe(Effect.mapError(Sandbox.Error.provider("apple")));

    const aquireSnapshot: Sandbox.Provider["aquireSnapshot"] = (options) =>
      Image.aquireSnapshot(options).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );

    const deriveSnapshot: Sandbox.Provider["deriveSnapshot"] = (options) =>
      Image.deriveSnapshot(options).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );

    const runSandbox: Sandbox.Provider["runSandbox"] = ({ handle, resources }) =>
      AppleSandbox.runSandbox({ handle, portMappings, resources, timeout }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);
