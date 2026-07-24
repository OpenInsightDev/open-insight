import type { NodeSdk } from "@effect/opentelemetry";

export type Config = Readonly<{
  readonly otel?: NodeSdk.Configuration;

  readonly snapshotConcurrency?: number;
  readonly taskConcurrency?: number;
  readonly trailConcurrency?: number;

  /** Maximum additional agent turns requested by a grader. Defaults to 3. */
  readonly graderMaxRetries?: number;

  readonly verifMode?: boolean;
}>;
