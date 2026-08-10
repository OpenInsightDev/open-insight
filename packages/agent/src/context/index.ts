import { Context, Effect, Layer } from "effect";
import * as Middle from "./middleware.ts";

export type ContextManagement = Readonly<{
  middlewares: Set<Middle.Middleware>;

  applyAfterRespond: (
    state: Middle.AfterRespondState,
  ) => Effect.Effect<Middle.AfterRespondResult, never>;

  applyPrePrompt: (state: Middle.PrePromptState) => Effect.Effect<Middle.PrePromptResult, never>;
}>;

export class Service extends Context.Service<Service, ContextManagement>()(
  "open-insight/ContextManagement",
) {}

/**
 * Creates a `ContextManagement` instance with an empty middleware set.
 *
 * **Details**
 *
 * Middlewares are added at runtime via {@link register} / {@link
 * registerPrePrompt} (which mutate the exposed `middlewares` set, so
 * registration takes effect on subsequent rounds). Both `apply` functions
 * fold over the registered middlewares in registration order, feeding each
 * middleware's output into the next:
 *
 * - `applyPrePrompt` runs only `PrePrompt` middlewares and returns the final
 *   `{ trajectory, prompt }` tuple to apply before the next round.
 * - `applyAfterRespond` runs only `AfterRespond` middlewares and returns the
 *   final `{ trajectory, responded }` tuple to commit after the round.
 *
 * The sandbox carried by the input state is a read-only context for every
 * middleware; it never appears in the returned tuple.
 */
export const make = Effect.fn(function* (): Effect.fn.Return<ContextManagement> {
  const middlewares = new Set<Middle.Middleware>();

  const applyAfterRespond = (
    state: Middle.AfterRespondState,
  ): Effect.Effect<Middle.AfterRespondResult, never> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, responded: state.responded }),
      (acc, middleware) =>
        Middle.Fn.$match(middleware.fn, {
          AfterRespond: ({ fn }) => fn({ ...state, ...acc }),
          PrePrompt: () => Effect.succeed(acc),
        }),
    );

  const applyPrePrompt = (
    state: Middle.PrePromptState,
  ): Effect.Effect<Middle.PrePromptResult, never> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, prompt: state.prompt }),
      (acc, middleware) =>
        Middle.Fn.$match(middleware.fn, {
          PrePrompt: ({ fn }) => fn({ ...state, ...acc }),
          AfterRespond: () => Effect.succeed(acc),
        }),
    );

  return {
    middlewares,
    applyAfterRespond,
    applyPrePrompt,
  } satisfies ContextManagement;
});

/**
 * Registers a middleware (either kind) on the current `Service`.
 *
 * **Details**
 *
 * Takes an `Fn` tagged enum, mirroring `Middle.make`. Prefer the
 * type-safe conveniences {@link registerAfterRespond} / {@link
 * registerPrePrompt} at call sites.
 */
export const register =
  (fn: Middle.Fn, options: Middle.MetadataEncoded) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.tap(() =>
        Effect.flatMap(Service, (ctx) =>
          Effect.map(Middle.make(fn, options), (middleware) => {
            ctx.middlewares.add(middleware);
          }),
        ),
      ),
    );

/**
 * Registers an `AfterRespond` middleware on the current `Service`.
 *
 * **Details**
 *
 * The middleware runs after each response and transforms
 * `{ sandbox, trajectory, responded }`; the applied tuple is committed by
 * the agent loop before the next round.
 */
export const registerAfterRespond = (fn: Middle.AfterRespondFn, options: Middle.MetadataEncoded) =>
  register(Middle.Fn.AfterRespond({ fn }), options);

/**
 * Registers a `PrePrompt` middleware on the current `Service`.
 *
 * **Details**
 *
 * The middleware runs right before the next prompting and transforms
 * `{ sandbox, trajectory, prompt }`; the returned prompt is what gets sent
 * to the language model.
 */
export const registerPrePrompt = (fn: Middle.PrePromptFn, options: Middle.MetadataEncoded) =>
  register(Middle.Fn.PrePrompt({ fn }), options);

export const layer = Layer.effect(Service, make());
