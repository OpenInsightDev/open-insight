/**
 * The PTC host bridge ("compatibility layer").
 *
 * The bridge lives on the host side of the `node:vm` boundary. The generated
 * SDK functions in the VM delegate every call to a single `__ptc(name, args)`
 * global; this module implements that global by dispatching to the real,
 * handler-armed Effect AI `Toolkit`.
 *
 * Each call is normalised into a JSON-serializable discriminated union
 * `{ ok: true, value } | { ok: false, error }` so the (sandboxed) agent code can
 * branch on success/failure without seeing host errors.
 */
import { Context, Effect, Inspectable, Layer, Stream } from "effect";
import { type Toolkit } from "effect/unstable/ai";
import { PtcError } from "./error.ts";
import { specsOf, type ToolSpec } from "./schema.ts";

/** The JSON-safe result shape every SDK call resolves to. */
export type BridgeResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; error: string }>;

/** Format an arbitrary failure into a human/serialisable string. */
const formatCause = (cause: unknown): string =>
  cause instanceof globalThis.Error
    ? `${cause.name}: ${cause.message}`
    : Inspectable.toStringUnknown(cause);

export type BridgeService = Readonly<{
  /** The tool specs this bridge can dispatch to (drives SDK generation). */
  readonly specs: ReadonlyArray<ToolSpec>;
  /** Invoke a tool by name, returning a structured result (no extra requirements). */
  readonly call: (name: string, args: unknown) => Effect.Effect<BridgeResult, PtcError>;
  /** Host-side async bridge used as the VM `__ptc` global. */
  readonly vmCall: (name: string, args: unknown) => Promise<BridgeResult>;
}>;

export class Bridge extends Context.Service<Bridge, BridgeService>()("open-insight/Ptc/Bridge") {}

/**
 * Builds a {@link Bridge} layer from a handler-armed toolkit.
 *
 * @param toolkit  A `Toolkit.WithHandler` whose handlers are already wired
 *   (e.g. via {@link Toolkit#toLayer}).
 * @param services A layer satisfying every tool's declared dependencies
 *   (the `HandlerServices`, e.g. `Sandbox.Current`).
 */
export const make = (
  toolkit: Toolkit.WithHandler<any>,
  services: Layer.Layer<any>,
): Effect.Effect<BridgeService, never> =>
  Effect.sync(() => {
    const specs = specsOf(toolkit);
    // `services` supplies the (arbitrary) tool dependency services at the VM
    // boundary; `Effect.provide` removes them from the requirements, so the
    // resulting `call` is self-contained (`Effect<..., PtcError, never>`).
    const run = (name: string, args: unknown): Effect.Effect<BridgeResult, PtcError, never> =>
      Effect.provide(runCall(toolkit, name, args), services) as unknown as Effect.Effect<
        BridgeResult,
        PtcError,
        never
      >;
    return Bridge.of({
      specs,
      call: run,
      vmCall: (name, args) => Effect.runPromise(run(name, args)),
    });
  });

/** Builds a {@link Bridge} layer from a handler-armed toolkit. */
export const layer = (toolkit: Toolkit.WithHandler<any>, services: any): Layer.Layer<Bridge> =>
  Layer.effect(Bridge, make(toolkit, services));

/**
 * Executes a single tool call against the toolkit, normalising success and
 * failure into a {@link BridgeResult}.
 */
const runCall = (
  toolkit: Toolkit.WithHandler<any>,
  name: string,
  args: unknown,
): Effect.Effect<BridgeResult, PtcError, any> =>
  Effect.gen(function* () {
    const available = Object.keys(toolkit.tools);
    if (!Object.hasOwn(toolkit.tools, name) || toolkit.tools[name] === undefined) {
      return yield* Effect.fail(PtcError.toolNotFound(name, available));
    }

    const stream = yield* withHandlerCatch(toolkit, name, args).pipe(
      Effect.mapError((cause) => PtcError.toolCallFailed(name, cause)),
    );
    const parts = yield* Stream.runCollect(stream).pipe(
      Effect.mapError((cause) => {
        // `failureMode: "error"` tools surface handler errors in the error
        // channel; surface them as a structured `{ ok: false }` result instead.
        return PtcError.toolCallFailed(name, cause);
      }),
    );
    const final = [...parts].reverse().find((part) => part.preliminary === false);

    if (final === undefined) {
      return yield* Effect.fail(PtcError.toolCallFailed(name, new Error("no final result")));
    }
    if (final.isFailure) {
      return { ok: false, error: formatCause(final.encodedResult) };
    }
    return { ok: true, value: final.encodedResult };
  });

const withHandlerCatch = (toolkit: Toolkit.WithHandler<any>, name: string, args: unknown) =>
  toolkit.handle(name, args as never);
