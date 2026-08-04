import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Effect } from "effect";
import { TaskError } from "./error.ts";

export type PromptInit = Prompt.RawInput;

export type Context = Sandbox.ReadonlySandboxPromise & Readonly<{ trajectory: Prompt.Trajectory }>;

/**
 * Creates a fresh prompt iterable for one stage execution.
 *
 * The factory receives the context for the first generated message because
 * an async iterator ignores the argument to its first `next` call. Each later
 * context is passed to the iterator that this factory creates.
 */
export type PromptFactory = (context: Context) => AsyncIterable<Prompt.RawInput, void, Context>;

export type PromptFnPromise = (context: Context) => Promise<Prompt.RawInput | null>;

export type PromptOptions =
  // return Prompt.RawInput immediately, then always return null
  | PromptInit
  // derive the next Prompt.RawInput from the trajectory and sandbox state
  | PromptFnPromise
  // optionally return `init`, then receive inputs and generate subsequent raw prompts
  | Readonly<{
      init?: PromptInit;
      followUp: PromptFactory;
    }>;

/**
 * Produces the next batch of user messages from the agent session and sandbox state.
 *
 * Returning `null` completes the prompt. Raw input is converted to a
 * trajectory immediately before it is returned.
 */
export type PromptFn = (context: Context) => Effect.Effect<Prompt.Trajectory | null, Error>;

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
  let iterator: AsyncIterator<Prompt.RawInput, void, Context> | undefined;

  return Effect.fn(function* (context: Context) {
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      return Prompt.make(next);
    }

    const next = yield* Effect.tryPromise({
      try: () => {
        if (iterator === undefined) {
          iterator = factory(context)[Symbol.asyncIterator]();
          return iterator.next();
        }
        return iterator.next(context);
      },
      catch: TaskError.prompt,
    });

    return next.done ? null : Prompt.make(next.value);
  });
};

export const makePromptFn = (options: PromptOptions): PromptFn => {
  if (typeof options === "function") {
    return Effect.fn((context: Context) =>
      Effect.tryPromise({
        try: () => options(context),
        catch: TaskError.prompt,
      }).pipe(Effect.map((next) => (next === null ? null : Prompt.make(next)))),
    );
  }
  if (typeof options === "object" && options !== null && "followUp" in options) {
    return makeGeneratedPromptFn(options.followUp, options.init);
  }
  return makeStaticPromptFn(options);
};
