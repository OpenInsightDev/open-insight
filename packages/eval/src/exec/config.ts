import { Sandbox } from "@open-insight/core/internal";
import * as Harness from "../harness/index.ts";

export type Config = Readonly<{
  readonly harnessConfig?: Harness.Config;
  readonly sandboxConfig?: Sandbox.Config;
}>;
