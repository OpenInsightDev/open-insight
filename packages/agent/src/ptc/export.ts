/**
 * Public exports for the `ptc` (Programmatic Tool Calling) module.
 *
 * `ptc` models every external tool as a TypeScript SDK: the agent writes
 * `.ts` code in an in-memory environment, which is type-checked & compiled with
 * `tsgo`, then executed in a sandboxed `node:vm` whose `__ptc` bridge routes
 * SDK calls back to the real tool implementations.
 */
export { Ptc } from "./service.ts";
export {
  Bridge,
  layer as bridgeLayer,
  make as makeBridge,
  type BridgeService,
  type BridgeResult,
} from "./bridge.ts";
export { generate as generateSdk, type SdkAssets } from "./sdk.ts";
export { jsonSchemaToDts, type JsonSchemaToDtsOptions } from "./dts.ts";
export { toSpec, specsOf, type ToolSpec } from "./schema.ts";
export {
  typecheck as typecheckScript,
  compile as compileScript,
  run as runScript,
  type RunOptions,
  type RunResult,
} from "./runner.ts";
export {
  PtcError,
  ErrorReason,
  CompileFailed,
  RuntimeFailed,
  ToolCallFailed,
  ToolNotFound,
  TypeCheckFailed,
} from "./error.ts";

export * as Internal from "./index.ts";
