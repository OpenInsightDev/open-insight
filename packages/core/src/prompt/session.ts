import { Prompt } from "effect/unstable/ai";
import { Context, Effect, Layer, Option } from "effect";
import { PromptError } from "./error.ts";
import * as Sandox from "#/sandbox/index.ts";

export type Session = Readonly<{
  init: Prompt.Prompt;
  next: (
    response: Prompt.Prompt,
  ) => Effect.Effect<Option.Option<Prompt.Prompt>, PromptError, Sandox.Current>;
}>;

export type Provider = Readonly<{
  runSession(sandbox: Sandox.Sandbox): Effect.Effect<Session, PromptError>;
}>;

type SessionOptions = Readonly<{
  init: Prompt.RawInput;
  next: (
    response: Prompt.Prompt,
  ) => Effect.Effect<Prompt.RawInput | null, PromptError, Sandox.Current>;
}>;

type ProviderOptions = Readonly<{
  runSession(sandbox: Sandox.Sandbox): Effect.Effect<SessionOptions, PromptError>;
}>;

export const makeSession = ({ init, next }: SessionOptions) => ({
  init: Prompt.make(init),
  next: Effect.fn(function* (response) {
    const nextPrompt = next?.(response) ?? Effect.succeed(null);
    return yield* nextPrompt.pipe(
      Effect.mapError(PromptError.generate),
      Effect.map(Option.fromNullOr),
      Effect.map(Option.map(Prompt.make)),
    );
  }),
});

export const make = ({ runSession }: ProviderOptions) =>
  ({
    runSession: Effect.fn(function* (sandbox) {
      const session = yield* runSession(sandbox).pipe(Effect.mapError(PromptError.generate));
      return makeSession(session);
    }),
  }) satisfies Provider;

export class Service extends Context.Service<Service, Provider>()("prompt/TurnsService") {}

export const layerFrom = (options: ProviderOptions) => Layer.succeed(Service, make(options));
