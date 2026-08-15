import { Effect, LogLevel } from "effect";
import type { NodeSdk } from "@effect/opentelemetry";
import { Env } from "@open-insight/core";
import { EvalError } from "./error.ts";

/** Runtime configuration for an evaluation run. */
export type Config = Readonly<{
  /** Configuration for the OpenTelemetry Node SDK. Defaults to an empty configuration. */
  otel: NodeSdk.Configuration;

  /** Maximum number of snapshot builds executed concurrently. Defaults to `1`. */
  snapshotConcurrency: number;

  /** Maximum number of evaluation trails executed concurrently. Defaults to `32`. */
  trailConcurrency: number;

  /** Number of independent evaluation trails run for each task. Defaults to `1`. */
  trailCount: number;

  /** Whether to run verification instead of run agent. Defaults to `false`. */
  verify: boolean;

  /** Whether to emit Effect log output to the console during the run. Defaults to `true`. */
  console: boolean;

  /** Minimum severity for log output. Defaults to `"Info"`. Ignored when `console` is `false`. */
  logLevel: LogLevel.LogLevel;
}>;

/** Default runtime configuration used when no evaluation overrides are provided. */
export const DefaultConfig: Required<Config> = {
  otel: {},
  snapshotConcurrency: 32,
  trailConcurrency: 32,
  trailCount: 1,
  verify: false,
  console: true,
  logLevel: "Info",
};

/** Creates an evaluation configuration by applying overrides to {@link DefaultConfig}. */
export const make = (options: Partial<Config> = {}): Config => ({
  ...DefaultConfig,
  ...options,
});

/**
 * Resolves an evaluation configuration from run options, falling back to the
 * `OPENINSIGHT_LOG_LEVEL` environment variable for `logLevel` when no explicit
 * option is provided.
 */
export const resolveConfig = Effect.fn(function* (options: Partial<Config> = {}) {
  const envLogLevel = yield* Env.resolveLogLevel().pipe(Effect.mapError(EvalError.init));
  return make(options.logLevel === undefined ? { ...options, logLevel: envLogLevel } : options);
});
