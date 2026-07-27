import type { NodeSdk } from "@effect/opentelemetry";

/** Runtime configuration for an evaluation run. */
export type Config = Readonly<{
  /** Whether task sandbox snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheTaskSnapshot: boolean;

  /** Whether agent-derived snapshots may be reused from the snapshot cache. Defaults to `true`. */
  cacheAgentSnapshot: boolean;

  /** Configuration for the OpenTelemetry Node SDK. Defaults to an empty configuration. */
  otel: NodeSdk.Configuration;

  /** Maximum number of task snapshots prepared concurrently. Defaults to `8`. */
  snapshotConcurrency: number;

  /** Maximum number of tasks processed concurrently. Defaults to `8`. */
  taskConcurrency: number;

  /** Maximum number of evaluation trails executed concurrently. Defaults to `8`. */
  trailConcurrency: number;

  /** Number of independent evaluation trails run for each task. Defaults to `1`. */
  trailCount: number;

  /** Maximum additional agent turns requested by a grader. Defaults to 3. */
  graderMaxRetries: number;

  /** Whether to run stages with verifier agents and validate their expected grades. Defaults to `false`. */
  verifMode: boolean;
}>;

/** Default runtime configuration used when no evaluation overrides are provided. */
export const DefaultConfig: Required<Config> = {
  cacheTaskSnapshot: true,
  cacheAgentSnapshot: true,
  otel: {},
  snapshotConcurrency: 8,
  taskConcurrency: 8,
  trailConcurrency: 8,
  trailCount: 1,
  graderMaxRetries: 3,
  verifMode: false,
};

/** Creates an evaluation configuration by applying overrides to {@link DefaultConfig}. */
export const make = (options: Partial<Config> = {}): Config => ({
  ...DefaultConfig,
  ...options,
});
