import { Config, ConfigProvider, Effect } from "effect";

/**
 * Environment variable that overrides the cache root used by evaluation
 * task loaders. When unset, `CACHE_DIR_DEFAULT` is used.
 */
export const OPENINSIGHT_CACHE_DIR = "OPENINSIGHT_CACHE_DIR";

/** Default cache root, relative to the process working directory. */
export const CACHE_DIR_DEFAULT = ".open-insight";

const cacheDirConfig = Config.string(OPENINSIGHT_CACHE_DIR).pipe(
  Config.withDefault(CACHE_DIR_DEFAULT),
);

/**
 * Resolves the cache root from `OPENINSIGHT_CACHE_DIR`, falling back to
 * `CACHE_DIR_DEFAULT` when the variable is unset or empty.
 */
export const resolveCacheDir = Effect.fn(function* () {
  const provider = yield* ConfigProvider.ConfigProvider;
  return yield* cacheDirConfig.parse(provider);
});
