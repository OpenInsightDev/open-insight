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
export type PromptOptions =
  // return Prompt.Trajectory immediately, then always return null
  | PromptInit
  // receive input (first input is empty) and return Prompt.UserMessage for subsequent calls
  | AsyncIterable<Prompt.UserMessage, void, PromptFnInput>
  // return `init` first, then receive inputs and return Prompt.UserMessage for subsequent calls
  | Readonly<{
      init: PromptInit;
      then: AsyncIterable<Prompt.UserMessage, void, PromptFnInput>;
    }>;

/**
 * Produces the next batch of user messages from the current agent session.
 *
 * Returning `null` completes the prompt. A trajectory lets static input
 * preserve its entire initial sequence; generator input produces a
 * single-message trajectory for each subsequent invocation.
 */
export type PromptFn = (input: PromptFnInput) => Effect.Effect<Prompt.Trajectory | null, Error>;

const toTrajectory = (input: PromptInit): Prompt.Trajectory =>
  Prompt.isMessage(input) ? Prompt.make([input]) : input;

const isAsyncIterable = (
  options: PromptOptions,
): options is AsyncIterable<Prompt.UserMessage, void, PromptFnInput> =>
  Symbol.asyncIterator in options;

export const makePrompt = Effect.fn(function* (options: PromptOptions) {
  if (!isAsyncIterable(options) && !("then" in options)) {
    let pending: Prompt.Trajectory | null = toTrajectory(options);
    return ((_: PromptFnInput) => {
      const next = pending;
      pending = null;
      return Effect.succeed(next);
    }) satisfies PromptFn;
  }

  const init = isAsyncIterable(options) ? undefined : options.init;
  const then = isAsyncIterable(options) ? options : options.then;

  const iterator = yield* Effect.try({
    try: () => then[Symbol.asyncIterator](),
    catch: Error.prompt,
  });
  let pending: Prompt.Trajectory | undefined = init === undefined ? undefined : toTrajectory(init);

  return ((input: PromptFnInput) => {
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      return Effect.succeed(next);
    }

    return Effect.tryPromise({
      try: async () => {
        const next = await iterator.next(input);
        return next.done ? null : Prompt.make([next.value]);
      },
      catch: Error.prompt,
    });
  }) satisfies PromptFn;
});
