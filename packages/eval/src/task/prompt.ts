import { Prompt } from "@open-insight/core/internal";
import { Effect } from "effect";
import { Error } from "./error.ts";

export type PromptFnInput = {
  /**
   * Full trajectory of the agent's session.
   */
  trajectory: Prompt.Trajectory;
  /**
   * Newly generated messages since the last call.
   */
  generated: ReadonlyArray<Prompt.Message>;
};

export type PromptInit = Prompt.UserMessage | Prompt.Trajectory;

/**
 * Creates a fresh prompt iterable for one stage execution.
 *
 * The factory receives the input for the first generated message because an
 * async iterator ignores the argument to its first `next` call. Each later
 * input is passed to the iterator that this factory creates.
 */
export type PromptFactory = (
  input: PromptFnInput,
) => AsyncIterable<Prompt.UserMessage, void, PromptFnInput>;

export type PromptFnPromise = (trajectory: Prompt.Trajectory) => Promise<Prompt.Trajectory | null>;

export type PromptOptions =
  // return Prompt.Trajectory immediately, then always return null
  | PromptInit
  // derive each Prompt.UserMessage from the full trajectory
  | PromptFnPromise
  // optionally return `init`, then receive inputs and generate subsequent messages
  | Readonly<{
      init?: PromptInit;
      followUp: PromptFactory;
    }>;

/**
 * Produces the next batch of user messages from the current agent session.
 *
 * Returning `null` completes the prompt. A trajectory lets static input
 * preserve its entire initial sequence; callback and factory-backed inputs
 * produce a single-message trajectory for each subsequent invocation.
 */
export type PromptFn = (input: PromptFnInput) => Effect.Effect<Prompt.Trajectory | null, Error>;

const toTrajectory = (input: PromptInit): Prompt.Trajectory =>
  Prompt.isMessage(input) ? Prompt.make([input]) : input;

const makeStaticPrompt = (init: PromptInit): PromptFn => {
  let pending: Prompt.Trajectory | null = toTrajectory(init);
  return Effect.fn(() =>
    Effect.sync(() => {
      const next = pending;
      pending = null;
      return next;
    }),
  );
};

const makeGeneratedPrompt = (factory: PromptFactory, init?: PromptInit): PromptFn => {
  let pending = init === undefined ? undefined : toTrajectory(init);
  let iterator: AsyncIterator<Prompt.UserMessage, void, PromptFnInput> | undefined;

  return Effect.fn(function* (input: PromptFnInput) {
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      return next;
    }

    const next = yield* Effect.tryPromise({
      try: () => {
        if (iterator === undefined) {
          iterator = factory(input)[Symbol.asyncIterator]();
          return iterator.next();
        }
        return iterator.next(input);
      },
      catch: Error.prompt,
    });

    return next.done ? null : Prompt.make([next.value]);
  });
};

export const makePrompt = (options: PromptOptions): PromptFn => {
  if (typeof options === "function") {
    return Effect.fn(function* ({ trajectory }: PromptFnInput) {
      const next = yield* Effect.tryPromise({
        try: () => options(trajectory),
        catch: Error.prompt,
      });
      return next === null ? null : Prompt.make([next]);
    });
  }
  if ("followUp" in options) {
    return makeGeneratedPrompt(options.followUp, options.init);
  }
  return makeStaticPrompt(options);
};
