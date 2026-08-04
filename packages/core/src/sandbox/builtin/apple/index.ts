import { Sandbox, SandboxError } from "@open-insight/core";
import { Spawn } from "@open-insight/core/utils";
import { Crypto, Duration, Effect, FileSystem, Layer } from "effect";
import { ChildProcess as CP } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import * as Image from "./image.ts";
import * as AppleSandbox from "./sandbox.ts";

export type Options = Readonly<{
  timeout?: Duration.Input;
}>;

export const make = Effect.fn("sandbox/provider/apple")(
  function* ({
    timeout = "30 seconds",
  }: Options): Effect.fn.Return<
    Sandbox.Provider,
    SandboxError,
    Crypto.Crypto | FileSystem.FileSystem | Spawn.Service
  > {
    const crypto = yield* Crypto.Crypto;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* Spawn.Service;

    yield* spawner
      .success(CP.make`container builder start`)
      .pipe(Effect.mapError(SandboxError.provider("apple")));

    const aquireSnapshot = Effect.fn(function* (options) {
      return yield* Image.aquireSnapshot(options).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );
    }) satisfies Sandbox.Provider["aquireSnapshot"];

    const deriveSnapshot = Effect.fn(function* (options) {
      return yield* Image.deriveSnapshot(options).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );
    }) satisfies Sandbox.Provider["deriveSnapshot"];

    const runSandbox = Effect.fn(function* ({ handle, resources }) {
      return yield* AppleSandbox.runSandbox({ handle, resources, timeout }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Spawn.Service, spawner),
      );
    }) satisfies Sandbox.Provider["runSandbox"];

    return {
      aquireSnapshot,
      deriveSnapshot,
      runSandbox,
    } satisfies Sandbox.Provider;
  },
  (effect) => effect.pipe(Effect.provide(Spawn.Service.layer)),
);

export const layer = (
  options: Options = {},
): Layer.Layer<
  Sandbox.ProviderService,
  SandboxError,
  Crypto.Crypto | FileSystem.FileSystem | ChildProcessSpawner
> => Layer.effect(Sandbox.ProviderService)(make(options));
