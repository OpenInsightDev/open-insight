import { Sandbox } from "@open-insight/core/internal";
import type { NodeSdk } from "@effect/opentelemetry";
import * as Harness from "../harness/index.ts";

export type Config = Readonly<{
  readonly harnessConfig?: Harness.Config;
  readonly sandboxConfig?: Sandbox.Config;
  readonly otelConfig?: NodeSdk.Configuration;
}>;
