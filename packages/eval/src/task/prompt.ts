import { Prompt } from "@open-insight/core/internal";
import { Effect } from "effect";
import { Error } from "./error.ts";

export type PromptInit = Prompt.RawInput;

/**
 * Creates a fresh prompt iterable for one stage execution.
 *
 * The factory receives the trajectory for the first generated message because
 * an async iterator ignores the argument to its first `next` call. Each later
 * trajectory is passed to the iterator that this factory creates.
 */
export type PromptFactory = (
  trajectory: Prompt.Trajectory,
) => AsyncIterable<Prompt.RawInput, void, Prompt.Trajectory>;

export type PromptFnPromise = (trajectory: Prompt.Trajectory) => Promise<Prompt.RawInput | null>;

export type PromptOptions =
  // return Prompt.RawInput immediately, then always return null
  | PromptInit
  // derive the next Prompt.RawInput from the full trajectory
  | PromptFnPromise
  // optionally return `init`, then receive inputs and generate subsequent raw prompts
  | Readonly<{
      init?: PromptInit;
      followUp: PromptFactory;
    }>;

/**
 * Produces the next batch of user messages from the current agent session.
 *
 * Returning `null` completes the prompt. Raw input is converted to a
 * trajectory immediately before it is returned.
 */
export type PromptFn = (
  trajectory: Prompt.Trajectory,
) => Effect.Effect<Prompt.Trajectory | null, Error>;

const makeStaticPromptFn = (init: PromptInit): PromptFn => {
  let pending: Prompt.RawInput | null = init;
  return Effect.fn(() =>
    Effect.sync(() => {
      const next = pending;
      pending = null;
      return next === null ? null : Prompt.make(next);
    }),
  );
};

const makeGeneratedPromptFn = (factory: PromptFactory, init?: PromptInit): PromptFn => {
  let pending = init;
  let iterator: AsyncIterator<Prompt.RawInput, void, Prompt.Trajectory> | undefined;

  return Effect.fn(function* (trajectory: Prompt.Trajectory) {
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      return Prompt.make(next);
    }

    const next = yield* Effect.tryPromise({
      try: () => {
        if (iterator === undefined) {
          iterator = factory(trajectory)[Symbol.asyncIterator]();
          return iterator.next();
        }
        return iterator.next(trajectory);
      },
      catch: Error.prompt,
    });

    return next.done ? null : Prompt.make(next.value);
  });
};

export const makePromptFn = (options: PromptOptions): PromptFn => {
  if (typeof options === "function") {
    return Effect.fn((trajectory: Prompt.Trajectory) =>
      Effect.tryPromise({
        try: () => options(trajectory),
        catch: Error.prompt,
      }).pipe(Effect.map((next) => (next === null ? null : Prompt.make(next)))),
    );
  }
  if (typeof options === "object" && options !== null && "followUp" in options) {
    return makeGeneratedPromptFn(options.followUp, options.init);
  }
  return makeStaticPromptFn(options);
};
