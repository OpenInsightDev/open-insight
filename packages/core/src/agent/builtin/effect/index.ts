import { Chat, LanguageModel, Toolkit } from "effect/unstable/ai";
import { Effect, Match, Option, Ref, Stream } from "effect";
import * as Agent from "@/agent/index.ts";
import { AgentError } from "@/agent/error.ts";
import * as Sandbox from "@/sandbox/index.ts";
import type { Endpoint } from "@/agent/endpoint.ts";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { NodeHttpClient } from "@effect/platform-node";

const makeLLM = (endpoint: Endpoint): Effect.Effect<LanguageModel.Service> =>
  Match.value(endpoint)
    .pipe(
      Match.when({ type: "openai" }, ({ baseUrl, apiKey, model }) =>
        Effect.gen(function* () {
          const client = yield* OpenAiClient.make({ apiKey, apiUrl: baseUrl });
          return yield* OpenAiLanguageModel.make({ model }).pipe(
            Effect.provideService(OpenAiClient.OpenAiClient, client),
          );
        }),
      ),
      Match.when({ type: "anthropic" }, ({ baseUrl, apiKey, model }) =>
        Effect.gen(function* () {
          const client = yield* AnthropicClient.make({ apiKey, apiUrl: baseUrl });
          return yield* AnthropicLanguageModel.make({ model }).pipe(
            Effect.provideService(AnthropicClient.AnthropicClient, client),
          );
        }),
      ),
      Match.exhaustive,
    )
    .pipe(Effect.provide(NodeHttpClient.layerUndici));

export const makeAgent = Effect.fn(function* ({
  sandbox,
  endpoint,
  chat = Chat.empty,
  toolkit = Toolkit.empty,
}: {
  sandbox: Sandbox.Sandbox;
  endpoint: Endpoint;
  chat?: Effect.Effect<Chat.Service>;
  toolkit?: Toolkit.Toolkit<any>;
}): Effect.fn.Return<Agent.Agent, Agent.AgentError, LanguageModel.LanguageModel> {
  const llm = yield* makeLLM(endpoint);
  const service = yield* chat;
  return {
    trajectory: () => Ref.get(service.history),
    prompt: ({ prompt }) =>
      service
        .streamText<any>({ prompt, toolkit })
        .pipe(
          Stream.mapError(AgentError.stream),
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
}): Effect.fn.Return<Agent.Provider, Agent.AgentError, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;

  const runSession = Effect.fn(
    function* ({ sandbox, endpoint }) {
      return yield* makeAgent({ sandbox, endpoint, chat, toolkit });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider["runSession"];

  return {
    snapshotExtension: Option.none(),
    runSession,
  } satisfies Agent.Provider;
});
