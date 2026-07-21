import { Sandbox } from "@open-insight/core/internal";
import type { NodeSdk } from "@effect/opentelemetry";
import * as Harness from "../harness/index.ts";

export type Config = Readonly<{
  readonly harness?: Harness.Config;
  readonly sandbox?: Sandbox.Config;
  readonly otel?: NodeSdk.Configuration;

  readonly snapshotConcurrency?: number;
  readonly taskConcurrency?: number;
  readonly trailConcurrency?: number;

  /** Maximum additional agent turns requested by a grader. Defaults to 3. */
  readonly graderMaxRetries?: number;

  readonly verifMode?: boolean;
}>;
