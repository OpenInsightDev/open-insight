import { Context, Effect, Layer } from "effect";
import { ContextError } from "./error.ts";
import * as Middle from "./middleware.ts";

export * from "./error.ts";

export type ContextManagement = Readonly<{
  middlewares: Set<Middle.Middleware>;

  applyAfterRespond: (
    state: Middle.AfterRespondState,
  ) => Effect.Effect<Middle.AfterRespondResult, ContextError>;

  applyPrePrompt: (
    state: Middle.PrePromptState,
  ) => Effect.Effect<Middle.PrePromptResult, ContextError>;
}>;

export class Service extends Context.Service<Service, ContextManagement>()(
  "open-insight/ContextManagement",
) {}

export const make = Effect.fn(function* (): Effect.fn.Return<ContextManagement> {
  const middlewares = new Set<Middle.Middleware>();

  const applyAfterRespond = (
    state: Middle.AfterRespondState,
  ): Effect.Effect<Middle.AfterRespondResult, ContextError> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, responded: state.responded }),
      (acc, middleware) =>
        Middle.Fn.$match(middleware.fn, {
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
    state: Middle.PrePromptState,
  ): Effect.Effect<Middle.PrePromptResult, ContextError> =>
    Effect.reduce(
      [...middlewares],
      () => ({ trajectory: state.trajectory, prompt: state.prompt }),
      (acc, middleware) =>
        Middle.Fn.$match(middleware.fn, {
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

export const registerAfterRespond = (fn: Middle.AfterRespondFn, options: Middle.MetadataEncoded) =>
  register(Middle.Fn.AfterRespond({ fn }), options);

export const registerPrePrompt = (fn: Middle.PrePromptFn, options: Middle.MetadataEncoded) =>
  register(Middle.Fn.PrePrompt({ fn }), options);

export const layer = Layer.effect(Service, make());
