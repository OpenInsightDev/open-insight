/**
 * The PTC service — orchestrates SDK generation, the in-memory environment and
 * the compile/run pipeline.
 *
 * A single {@link Bridge} instance pins a concrete handler-armed toolkit; this
 * service derives the SDK assets from it, seeds an in-memory file tree, and
 * exposes `run` which type-checks, compiles and executes an agent script end to
 * end against the bridge.
 */
import { Context, Effect, FileSystem, Layer } from "effect";
import { Vm } from "#/vm/export.ts";
import { Bridge } from "./bridge.ts";
import { PtcError } from "./error.ts";
import { Runner, type RunOptions, type RunResult } from "./runner.ts";
import { generate, type SdkAssets } from "./sdk.ts";

export type PtcService = Readonly<{
  /** Generate the SDK assets (declarations + runtime) for the bridged tools. */
  readonly sdk: () => SdkAssets;
  /**
   * Seed an in-memory file system with the SDK layout, giving the agent its
   * working environment (docs + runtime).
   */
  readonly seed: (fs: FileSystem.FileSystem) => Effect.Effect<void, PtcError>;
  /** Type-check, compile and run an agent script against the bridged tools. */
  readonly run: (script: string, options?: RunOptions) => Effect.Effect<RunResult, PtcError, Vm>;
}>;

export class Ptc extends Context.Service<Ptc, PtcService>()("open-insight/Ptc") {
  /**
   * Build the PTC service from a bridge.
   *
   * @param bridge A layer providing the handler-armed {@link Bridge}.
   */
  static readonly layer = (bridge: Layer.Layer<Bridge>): Layer.Layer<Ptc> =>
    Layer.effect(
      Ptc,
      Effect.gen(function* () {
        const b = yield* Bridge;
        const runner = yield* Runner;
        return Ptc.of({
          sdk: () => generate(b.specs),
          seed: (fs) =>
            Effect.gen(function* () {
              for (const [path, content] of Object.entries(generate(b.specs).files)) {
                yield* fs.writeFileString(path, content);
              }
            }).pipe(Effect.mapError((cause) => PtcError.runtimeFailed(cause))),
          run: (script, options) =>
            Effect.gen(function* () {
              const assets = generate(b.specs);
              yield* runner.typecheck(script, assets, options);
              const js = yield* runner.compile(script, assets, options);
              return yield* runner.run(js, assets, b.vmCall, options);
            }),
        });
      }),
      // The layer provides only `Ptc`; callers must supply the tool-dependency
      // services (`Vm`, via `Vm.layer`) required by the `run` pipeline.
    ).pipe(Layer.provide(bridge), Layer.provide(Runner.layer));
}
