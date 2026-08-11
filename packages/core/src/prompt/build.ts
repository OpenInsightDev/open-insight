import { Effect, Option, Ref, Stream } from "effect";
import { Prompt } from "effect/unstable/ai";
import * as Sandbox from "#/sandbox/index.ts";
import { PromptError } from "./error.ts";
import type { Trajectory } from "./traj.ts";

export type Init = Prompt.RawInput;

export type Context = Sandbox.ReadonlySandboxPromise & Readonly<{ trajectory: Trajectory }>;

/**
 * Creates a fresh prompt iterable for one stage execution.
 *
 * The factory receives the context for the first generated message because
 * an async iterator ignores the argument to its first `next` call. Each later
 * context is passed to the iterator that this factory creates.
 */
export type Factory = (context: Context) => AsyncIterable<Prompt.RawInput, void, Context>;

export type FnPromise = (context: Context) => Promise<Prompt.RawInput | null>;

export type Options =
  // return Prompt.RawInput immediately, then always return null
  | Init
  // derive the next Prompt.RawInput from the trajectory and sandbox state
  | FnPromise
  // optionally return `init`, then receive inputs and generate subsequent raw prompts
  | Readonly<{
      init?: Init;
      followUp: Factory;
    }>;

/**
 * The runtime inputs a prompt stream is built from: the session trajectory
 * `Ref` and the sandbox.
 */
export type Input = Readonly<{
  trajectory: Ref.Ref<Trajectory>;
  sandbox: Sandbox.ReadonlySandboxPromise;
}>;

const makeStaticStream = (init: Init): Stream.Stream<Prompt.Prompt, PromptError> =>
  Stream.succeed(Prompt.make(init));

const makeFnStream = (
  fn: FnPromise,
  { trajectory, sandbox }: Input,
): Stream.Stream<Prompt.Prompt, PromptError> =>
  Stream.unfold(undefined, () =>
    Effect.gen(function* () {
      const context: Context = { ...sandbox, trajectory: yield* Ref.get(trajectory) };
      const next = yield* Effect.tryPromise({
        try: () => fn(context),
        catch: PromptError.generation,
      });
      return next === null ? undefined : [Prompt.make(next), undefined];
    }),
  );

type GeneratedState = Readonly<{
  pending: Option.Option<Init>;
  iterator: Option.Option<AsyncIterator<Prompt.RawInput, void, Context>>;
}>;

const makeFollowUpStream = (
  factory: Factory,
  init: Option.Option<Init>,
  { trajectory, sandbox }: Input,
): Stream.Stream<Prompt.Prompt, PromptError> =>
  Stream.unfold({ pending: init, iterator: Option.none() } satisfies GeneratedState, (state) =>
    Effect.gen(function* () {
      const context: Context = { ...sandbox, trajectory: yield* Ref.get(trajectory) };

      if (Option.isSome(state.pending)) {
        return [
          Prompt.make(state.pending.value),
          { pending: Option.none(), iterator: state.iterator },
        ];
      }

      if (Option.isSome(state.iterator)) {
        const iterator = state.iterator.value;
        const result = yield* Effect.tryPromise({
          try: () => iterator.next(context),
          catch: PromptError.generation,
        });
        return result.done ? undefined : [Prompt.make(result.value), state];
      }

      const iterator = factory(context)[Symbol.asyncIterator]();
      const result = yield* Effect.tryPromise({
        try: () => iterator.next(),
        catch: PromptError.generation,
      });
      return result.done
        ? undefined
        : [Prompt.make(result.value), { pending: Option.none(), iterator: Option.some(iterator) }];
    }),
  );

/**
 * Builds a fresh prompt stream for one stage execution.
 *
 * The `Options` argument selects the behavior:
 *
 * - pass a `Prompt.RawInput` to send it once and then complete,
 * - pass a `(context) => Promise<RawInput | null>` to derive each next prompt
 *   from the trajectory and sandbox state,
 * - or pass `{ init?, followUp }` to optionally send an `init` message first,
 *   then feed each `Context` into the `followUp` async-iterator factory.
 *
 * The `Input` provides the runtime session state. Each element the stream
 * generates reads the latest trajectory from the `Ref` and passes it to the
 * prompt function as its context, so prompts always reflect the most recent
 * agent response. Returning `null` from the prompt function completes the
 * stream. Every call produces a fresh stream, so state never leaks between
 * stage runs.
 */
export const makeStream = (
  options: Options,
  input: Input,
): Stream.Stream<Prompt.Prompt, PromptError> => {
  if (typeof options === "function") {
    return makeFnStream(options, input);
  }
  if (typeof options === "object" && options !== null && "followUp" in options) {
    return makeFollowUpStream(options.followUp, Option.fromUndefinedOr(options.init), input);
  }
  return makeStaticStream(options);
};
