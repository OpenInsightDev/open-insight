export { Vm } from "./vm.ts";
export {
  Script,
  type CompileFunctionOptions,
  type Context,
  type CreateContextOptions,
  type RunningCodeInNewContextOptions,
  type RunningCodeOptions,
  type RunningScriptInNewContextOptions,
  type RunningScriptOptions,
  type ScriptOptions,
} from "./script.ts";
export {
  VmError,
  CompileFailure,
  RuntimeFailure,
  ExecutionTimeout,
  InvalidContext,
  ErrorReason,
} from "./error.ts";
