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
export type PromptOptions =
  // return Prompt.Trajectory immediately, then always return null
  | PromptInit
  // receive the initial input, then return Prompt.UserMessage for each call
  | PromptFactory
  // return `init` first, then receive inputs and return Prompt.UserMessage for subsequent calls
  | Readonly<{
      init: PromptInit;
      followUp: PromptFactory;
    }>;

/**
 * Produces the next batch of user messages from the current agent session.
 *
 * Returning `null` completes the prompt. A trajectory lets static input
 * preserve its entire initial sequence; factory-backed input produces a
 * single-message trajectory for each subsequent invocation.
 */
export type PromptFn = (input: PromptFnInput) => Effect.Effect<Prompt.Trajectory | null, Error>;

const toTrajectory = (input: PromptInit): Prompt.Trajectory =>
  Prompt.isMessage(input) ? Prompt.make([input]) : input;

export const makePrompt = Effect.fn((options: PromptOptions) =>
  Effect.sync((): PromptFn => {
    if (typeof options !== "function" && !("followUp" in options)) {
      let pending: Prompt.Trajectory | null = toTrajectory(options);
      return (_: PromptFnInput) => {
        const next = pending;
        pending = null;
        return Effect.succeed(next);
      };
    }

    const init = typeof options === "function" ? undefined : options.init;
    const factory = typeof options === "function" ? options : options.followUp;
    let pending: Prompt.Trajectory | undefined =
      init === undefined ? undefined : toTrajectory(init);
    let iterator: AsyncIterator<Prompt.UserMessage, void, PromptFnInput> | undefined;

    return (input: PromptFnInput) => {
      if (pending !== undefined) {
        const next = pending;
        pending = undefined;
        return Effect.succeed(next);
      }

      return Effect.tryPromise({
        try: async () => {
          const current = iterator;
          const next =
            current === undefined
              ? await (iterator = factory(input)[Symbol.asyncIterator]()).next()
              : await current.next(input);
          return next.done ? null : Prompt.make([next.value]);
        },
        catch: Error.prompt,
      });
    };
  }),
);
