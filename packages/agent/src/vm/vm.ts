/**
 * The `Vm` service models Node's `node:vm` module as an Effect service.
 *
 * It follows the same shape as the Node adapters in `@effect/platform-node`: a
 * platform `Context.Service` exposing the synchronous `node:vm` surface, with
 * run methods lifted into `Effect` so failures are reported as typed `VmError`s
 * instead of raw throws.
 *
 * Code runs synchronously via `node:vm`; long-running or untrusted code should
 * use the `timeout` option (surfaced as `ExecutionTimeout`) or be executed on a
 * separate worker for full preemption.
 */
import { Context, Effect, Layer } from "effect";
import * as NodeVM from "node:vm";
import { VmError } from "./error.ts";
import {
  classifyRunFailure,
  Script,
  type CompileFunctionOptions,
  type Context as VmContext,
  type CreateContextOptions,
  type RunningCodeInNewContextOptions,
  type RunningCodeOptions,
  type ScriptOptions,
} from "./script.ts";

const compile = (code: string, options?: ScriptOptions) =>
  Effect.try({
    try: () => Script.from(new NodeVM.Script(code, options)),
    catch: (cause) => VmError.compile(options?.filename ?? "", cause),
  });

const runInContext = (code: string, contextifiedSandbox: VmContext, options?: RunningCodeOptions) =>
  Effect.try({
    try: () => NodeVM.runInContext(code, contextifiedSandbox, options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

const runInNewContext = (
  code: string,
  sandbox?: VmContext,
  options?: RunningCodeInNewContextOptions,
) =>
  Effect.try({
    try: () => NodeVM.runInNewContext(code, sandbox, options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

const runInThisContext = (code: string, options?: RunningCodeOptions) =>
  Effect.try({
    try: () => NodeVM.runInThisContext(code, options),
    catch: (cause) => classifyRunFailure(options?.filename ?? "", cause),
  });

const compileFunction = (
  code: string,
  params?: readonly string[],
  options?: CompileFunctionOptions,
) =>
  Effect.try({
    try: () => NodeVM.compileFunction(code, params, options),
    catch: (cause) => VmError.compile(options?.filename ?? "", cause),
  });

/**
 * The `Vm` service exposing the `node:vm` API through Effect.
 */
export class Vm extends Context.Service<
  Vm,
  {
    /**
     * Contextifies the given `sandbox` object, so it can be used as the global
     * for `runInContext` and `Script.runInContext`. If no sandbox is given, a
     * fresh empty contextified object is created.
     */
    readonly createContext: (sandbox?: VmContext, options?: CreateContextOptions) => VmContext;

    /** Reports whether the given object has been contextified. */
    readonly isContext: (sandbox: VmContext) => boolean;

    /**
     * Compiles `code` into a reusable {@link Script} handle.
     */
    readonly script: (code: string, options?: ScriptOptions) => Effect.Effect<Script, VmError>;

    /**
     * Compiles and runs `code` within the given contextified sandbox, returning
     * the result of the last statement.
     */
    readonly runInContext: (
      code: string,
      contextifiedSandbox: VmContext,
      options?: RunningCodeOptions,
    ) => Effect.Effect<unknown, VmError>;

    /**
     * Compiles `code`, creates a fresh context (seeded with `sandbox` if
     * provided), runs the code within it, and returns the result of the last
     * statement.
     */
    readonly runInNewContext: (
      code: string,
      sandbox?: VmContext,
      options?: RunningCodeInNewContextOptions,
    ) => Effect.Effect<unknown, VmError>;

    /**
     * Compiles and runs `code` within the global object of the current context,
     * returning the result of the last statement.
     */
    readonly runInThisContext: (
      code: string,
      options?: RunningCodeOptions,
    ) => Effect.Effect<unknown, VmError>;

    /**
     * Compiles `code` into a function with the given parameter names, optionally
     * within the provided parsing context.
     */
    readonly compileFunction: (
      code: string,
      params?: readonly string[],
      options?: CompileFunctionOptions,
    ) => Effect.Effect<ReturnType<typeof NodeVM.compileFunction>, VmError>;
  }
>()("open-insight/Vm") {
  /**
   * Provides the `Vm` service backed directly by `node:vm`.
   *
   * @category layers
   */
  static readonly layer: Layer.Layer<Vm> = Layer.effect(
    this,
    Effect.gen(function* () {
      return Vm.of({
        createContext: (sandbox, options) =>
          sandbox === undefined
            ? NodeVM.createContext(options)
            : NodeVM.createContext(sandbox, options),
        isContext: (sandbox) => NodeVM.isContext(sandbox),
        script: compile,
        runInContext,
        runInNewContext,
        runInThisContext,
        compileFunction,
      });
    }),
  );
}
