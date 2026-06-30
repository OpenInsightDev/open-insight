import { Effect, FileSystem, Path } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { resolveDist } from "./dist.ts";
import { type Context, type DistFileType, type Mode, ModeSchema } from "./schema.ts";
import { SandboxError } from "../error.ts";

export const resolve = Effect.fn(function* (
  mode: Mode,
): Effect.fn.Return<
  Context,
  SandboxError,
  ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
> {
  const path = yield* Path.Path;

  return yield* ModeSchema.match(mode, {
    Dir: ({ path }) => Effect.succeed(path),
    Dist: resolveDist,
    Script: () => Effect.succeed(import.meta.dirname!),
    Cwd: () => Effect.succeed(path.resolve(".")),
  });
});

export const make: typeof ModeSchema.make = (args) => ModeSchema.make(args);

/**
 * Indicates that the context should be a specific directory.
 */
export const makeDir = (path: string) => ModeSchema.make({ _tag: "Dir", path });

/**
 * Indicates that the context should be downloaded from a distribution archive.
 */
export const makeDist = ({ url, fileType }: { url: string; fileType: DistFileType }) =>
  ModeSchema.make({ _tag: "Dist", url, fileType });

/**
 * Indicates that the context should be the script's directory.
 * This is useful for resolving relative paths in scripts.
 */
export const Script = ModeSchema.make({ _tag: "Script" });

/**
 * Indicates that the context should be the current working directory.
 */
export const Cwd = ModeSchema.make({ _tag: "Cwd" });

export * from "./schema.ts";
