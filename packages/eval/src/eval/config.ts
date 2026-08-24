import type { NodeSdk } from "@effect/opentelemetry";

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
}>;

/** Default runtime configuration used when no evaluation overrides are provided. */
export const DefaultConfig: Required<Config> = {
  otel: {},
  snapshotConcurrency: 32,
  trailConcurrency: 32,
  trailCount: 1,
  verify: false,
};

/** Creates an evaluation configuration by applying overrides to {@link DefaultConfig}. */
export const make = (options: Partial<Config> = {}): Config => ({
  ...DefaultConfig,
  ...options,
});
