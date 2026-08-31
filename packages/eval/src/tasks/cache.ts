import { Effect, FileSystem, Path } from "effect";
import { Env } from "@open-insight/core";

/**
 * The cache dir used by task source loaders, resolved from
 * `OPENINSIGHT_CACHE_DIR` (defaulting to `.open-insight`) with an `eval`
 * suffix appended.
 */
export const cacheDir = Effect.fn(function* (subpath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cacheDir = yield* Env.resolveCacheDir();
  const root = path.resolve(cacheDir, "eval", subpath);
  yield* fs.makeDirectory(root, { recursive: true });
  return root;
});
