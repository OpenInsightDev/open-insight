import { Effect, FileSystem } from "effect";
import { resolveCacheDir } from "../env.ts";

/**
 * Resolve the cache directory path from configuration and ensure it exists on
 * disk. Returns the absolute or relative path as configured.
 */
export const ensureCacheDir = Effect.fn("ensureCacheDir")(function* () {
  const dir = yield* resolveCacheDir();
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(dir, { recursive: true });
  return dir;
});
