import { Config, ConfigProvider, Effect, LogLevel } from "effect";

/**
 * Environment variable controlling the minimum severity of Effect log
 * output. Following Effect's official log-level config, accepted values are
 * the `LogLevel` literals: `"All"`, `"Fatal"`, `"Error"`, `"Warn"`,
 * `"Info"`, `"Debug"`, `"Trace"`, or `"None"`.
 */
export const OPENINSIGHT_LOG_LEVEL = "OPENINSIGHT_LOG_LEVEL";

/** Default minimum log severity used when `OPENINSIGHT_LOG_LEVEL` is unset. */
export const OPENINSIGHT_LOG_LEVEL_DEFAULT: LogLevel.LogLevel = "Info";

const logLevelConfig = Config.logLevel(OPENINSIGHT_LOG_LEVEL).pipe(
  Config.withDefault(OPENINSIGHT_LOG_LEVEL_DEFAULT),
);

/**
 * Resolves the log level from `OPENINSIGHT_LOG_LEVEL`, falling back to
 * `OPENINSIGHT_LOG_LEVEL_DEFAULT` when the variable is unset.
 */
export const resolveLogLevel = Effect.fn(function* () {
  const provider = yield* ConfigProvider.ConfigProvider;
  return yield* logLevelConfig.parse(provider);
});
