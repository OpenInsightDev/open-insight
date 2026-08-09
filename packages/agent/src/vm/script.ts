/**
 * The `Script` handle returned by `Vm.script`, wrapping a precompiled
 * `node:vm.Script`.
 *
 * A script is compiled once and can be executed any number of times, in the
 * same or different contexts. Concrete management — like timeouts and context
 * checks — is delegated to `node:vm`; failures are normalized to {@link VmError}.
 */
import { Effect } from "effect";
import type * as NodeVM from "node:vm";
import { VmError } from "./error.ts";

export type Context = NodeVM.Context;

export type CreateContextOptions = NodeVM.CreateContextOptions;
export type ScriptOptions = NodeVM.ScriptOptions;
export type RunningCodeOptions = NodeVM.RunningCodeOptions;
export type RunningCodeInNewContextOptions = NodeVM.RunningCodeInNewContextOptions;
export type RunningScriptOptions = NodeVM.RunningScriptOptions;
export type RunningScriptInNewContextOptions = NodeVM.RunningScriptInNewContextOptions;
export type CompileFunctionOptions = NodeVM.CompileFunctionOptions;

const getErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = cause.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
};

/**
 * Maps a failure thrown while *running* a script to a {@link VmError},
 * distinguishing the errors `node:vm` surfaces for timeouts and for running
 * against a non-contextified sandbox from general runtime failures.
 */
const isSyntaxError = (cause: unknown): boolean => {
  if (typeof cause === "object" && cause !== null) {
    const name = (cause as { name?: unknown }).name;
    const ctor = (cause as { constructor?: { name?: unknown } }).constructor?.name;
    return name === "SyntaxError" || ctor === "SyntaxError";
  }
  return false;
};

export const classifyRunFailure = (filename: string, cause: unknown): VmError => {
  switch (getErrorCode(cause)) {
    case "ERR_SCRIPT_EXECUTION_TIMEOUT":
      return VmError.timeout(cause);
    case "ERR_VM_INVALID_CONTEXT_OBJECT":
    case "ERR_INVALID_ARG_TYPE":
      return VmError.invalidContext(cause);
    default:
      // `vm.runIn*Context` compiles and runs in a single call, so a syntax
      // error is surfaced during execution; report it as a compile failure.
      return isSyntaxError(cause)
        ? VmError.compile(filename, cause)
        : VmError.runtime(filename, cause);
  }
};

const runInContext = (internal: NodeVM.Script, context: Context, options?: RunningScriptOptions) =>
  Effect.try({
    try: () => internal.runInContext(context, options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

const runInNewContext = (
  internal: NodeVM.Script,
  sandbox?: Context,
  options?: RunningScriptInNewContextOptions,
) =>
  Effect.try({
    try: () => internal.runInNewContext(sandbox, options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

const runInThisContext = (internal: NodeVM.Script, options?: RunningScriptOptions) =>
  Effect.try({
    try: () => internal.runInThisContext(options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

/**
 * A precompiled script that can be executed against one or more contexts.
 */
export class Script {
  private constructor(readonly internal: NodeVM.Script) {}

  /** Wraps an already-compiled `node:vm.Script`. */
  static from(internal: NodeVM.Script): Script {
    return new Script(internal);
  }

  /**
   * Runs the compiled code within the given contextified sandbox, returning the
   * result of the last statement.
   */
  runInContext(context: Context, options?: RunningScriptOptions): Effect.Effect<unknown, VmError> {
    return runInContext(this.internal, context, options);
  }

  /**
   * Runs the compiled code in a newly created context, optionally seeded with
   * the given `sandbox`, returning the result of the last statement.
   */
  runInNewContext(
    sandbox?: Context,
    options?: RunningScriptInNewContextOptions,
  ): Effect.Effect<unknown, VmError> {
    return runInNewContext(this.internal, sandbox, options);
  }

  /**
   * Runs the compiled code within the global object of the current context,
   * returning the result of the last statement.
   */
  runInThisContext(options?: RunningScriptOptions): Effect.Effect<unknown, VmError> {
    return runInThisContext(this.internal, options);
  }

  /**
   * Returns a buffer of V8 code cache data for the compiled source, which can
   * be passed back in as `cachedData` to skip recompilation.
   */
  createCachedData(): Uint8Array {
    return this.internal.createCachedData();
  }
}
