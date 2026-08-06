import { LogLevel } from "effect";
import type { NodeSdk } from "@effect/opentelemetry";
import { Harness } from "@open-insight/core/internal";

/** Runtime configuration for an evaluation run. */
export type Config =
  /** Configuration for harness to run Snapshot. */
  Harness.SnapshotSessionConfig &
    Readonly<{
      /** Configuration for the OpenTelemetry Node SDK. Defaults to an empty configuration. */
      otel: NodeSdk.Configuration;

      /** Maximum number of task snapshots prepared concurrently. Defaults to `32`. */
      snapshotConcurrency: number;

      /** Maximum number of tasks processed concurrently. Defaults to `32`. */
      taskConcurrency: number;

      /** Maximum number of evaluation trails executed concurrently. Defaults to `32`. */
      trailConcurrency: number;

      /** Number of independent evaluation trails run for each task. Defaults to `1`. */
      trailCount: number;

      /** Maximum additional agent turns requested by a grader. Defaults to 3. */
      graderMaxRetries: number;

      /** Whether to run stages with verifier agents and validate their expected grades. Defaults to `false`. */
      verifMode: boolean;

      /** Whether to emit Effect log output to the console during the run. Defaults to `true`. */
      console: boolean;

      /** Minimum severity for log output. Defaults to `"Info"`. Ignored when `console` is `false`. */
      logLevel: LogLevel.LogLevel;
    }>;

/** Default runtime configuration used when no evaluation overrides are provided. */
export const DefaultConfig: Required<Config> = {
  ...Harness.DefaultSnapshotSessionConfig,
  otel: {},
  snapshotConcurrency: 32,
  taskConcurrency: 32,
  trailConcurrency: 32,
  trailCount: 1,
  graderMaxRetries: 3,
  verifMode: false,
  console: true,
  logLevel: "Info",
};

/** Creates an evaluation configuration by applying overrides to {@link DefaultConfig}. */
export const make = (options: Partial<Config> = {}): Config => ({
  ...DefaultConfig,
  ...options,
});
