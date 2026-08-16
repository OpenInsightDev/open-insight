import { Context, Effect, Layer } from "effect";
import { ContextError } from "./error.ts";
import * as MW from "./middleware.ts";

export type ContextManagement = Readonly<{
  middlewares: Set<MW.Middleware>;

  applyAfterRespond: (
    state: MW.AfterRespondState,
  ) => Effect.Effect<MW.AfterRespondResult, ContextError>;

  applyPrePrompt: (state: MW.PrePromptState) => Effect.Effect<MW.PrePromptResult, ContextError>;
}>;

export class Service extends Context.Service<Service, ContextManagement>()(
  "open-insight/ContextManagement",
) {}

export const make = Effect.fn(function* (): Effect.fn.Return<ContextManagement> {
  const middlewares = new Set<MW.Middleware>();

  const applyAfterRespond = (
    state: MW.AfterRespondState,
  ): Effect.Effect<MW.AfterRespondResult, ContextError> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, responded: state.responded }),
      (acc, middleware) =>
        MW.Fn.$match(middleware.fn, {
          AfterRespond: ({ fn }) =>
            fn({ ...state, ...acc }).pipe(
              Effect.mapError((cause) =>
                ContextError.middlewareFailed(middleware.metadata.name, cause),
              ),
            ),
          PrePrompt: () => Effect.succeed(acc),
        }),
    );

  const applyPrePrompt = (
    state: MW.PrePromptState,
  ): Effect.Effect<MW.PrePromptResult, ContextError> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, prompt: state.prompt }),
      (acc, middleware) =>
        MW.Fn.$match(middleware.fn, {
          PrePrompt: ({ fn }) =>
            fn({ ...state, ...acc }).pipe(
              Effect.mapError((cause) =>
                ContextError.middlewareFailed(middleware.metadata.name, cause),
              ),
            ),
          AfterRespond: () => Effect.succeed(acc),
        }),
    );

  return {
    middlewares,
    applyAfterRespond,
    applyPrePrompt,
  } satisfies ContextManagement;
});

export const register =
  (fn: MW.Fn, options: MW.MetadataEncoded) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.tap(() =>
        Effect.flatMap(Service, (ctx) =>
          Effect.map(MW.make(fn, options), (middleware) => {
            ctx.middlewares.add(middleware);
          }),
        ),
      ),
    );

export const registerAfterRespond = (fn: MW.AfterRespondFn, options: MW.MetadataEncoded) =>
  register(MW.Fn.AfterRespond({ fn }), options);

export const registerPrePrompt = (fn: MW.PrePromptFn, options: MW.MetadataEncoded) =>
  register(MW.Fn.PrePrompt({ fn }), options);

export const layer = Layer.effect(Service, make());

export * from "./error.ts";
