import { Chat, LanguageModel, Toolkit } from "effect/unstable/ai";
import { Effect, Option, Ref, Stream } from "effect";
import * as Agent from "#/agent/index.ts";
import { Error } from "#/agent/error.ts";
import * as Sandbox from "#/sandbox/index.ts";

export const makeAgent = Effect.fn(function* ({
  sandbox,
  chat = Chat.empty,
  toolkit = Toolkit.empty,
}: {
  sandbox: Sandbox.Sandbox;
  chat?: Effect.Effect<Chat.Service>;
  toolkit?: Toolkit.Toolkit<any>;
}): Effect.fn.Return<Agent.Agent, Agent.Error, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;
  const service = yield* chat;
  return {
    trajectory: () => Ref.get(service.history),
    prompt: ({ prompt }) =>
      service
        .streamText<any>({ prompt, toolkit })
        .pipe(
          Stream.mapError(Error.stream),
          Stream.provideService(LanguageModel.LanguageModel, llm),
        ),
  } satisfies Agent.Agent;
});

export const make = Effect.fn(function* ({
  chat = Chat.empty,
  toolkit = Toolkit.empty,
}: {
  chat?: Effect.Effect<Chat.Service>;
  toolkit?: Toolkit.Toolkit<any>;
}): Effect.fn.Return<Agent.Provider, Agent.Error, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;

  const runSession = Effect.fn(
    function* ({ sandbox }) {
      return yield* makeAgent({ sandbox, chat, toolkit });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider["runSession"];

  return {
    snapshotExtension: Option.none(),
    runSession,
  } satisfies Agent.Provider;
});
