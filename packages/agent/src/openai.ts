import {
  OpenAiClient as OpenAiCompatClient,
  OpenAiLanguageModel as OpenAiCompatLanguageModel,
} from "@effect/ai-openai-compat";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { NodeFileSystem } from "@effect/platform-node";
import type { Agent } from "@open-insight/core";
import { Config, ConfigProvider, Effect, Layer, Redacted } from "effect";
import type { PlatformError } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { make } from "#/agent.ts";
import * as SandboxToolkit from "#/toolkit.ts";

export type OpenAiConfig = Readonly<{
  apiKey: Config.Config<string>;
  baseUrl: Config.Config<string>;
  dotenvPath: string;
  model: string;
}>;

export type OpenAiEndpoint = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
}>;

type OpenAiAgent = Effect.Effect<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error | Config.ConfigError | PlatformError.PlatformError
>;

type ResolvedOpenAiConfig = Readonly<{
  apiKey: Redacted.Redacted<string>;
  baseUrl: string;
  model: string;
}>;

const resolveConfig = Effect.fn("Agent.resolveOpenAiConfig")(function* (config: OpenAiConfig) {
  const providerLayer = ConfigProvider.layer(
    ConfigProvider.fromDotEnv({ path: config.dotenvPath }),
  ).pipe(Layer.provide(NodeFileSystem.layer));

  const values = yield* Config.all({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  }).pipe(Effect.provide(providerLayer));

  return { ...values, apiKey: Redacted.make(values.apiKey), model: config.model };
});

const openAiLanguageModelLayerResolved = ({
  apiKey,
  baseUrl,
  model,
}: ResolvedOpenAiConfig): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  HttpClient.HttpClient
> => {
  const clientLayer = OpenAiClient.layer({ apiKey, apiUrl: baseUrl });
  return OpenAiLanguageModel.model(model).pipe(Layer.provide(clientLayer));
};

const openAiCompatLanguageModelLayerResolved = ({
  apiKey,
  baseUrl,
  model,
}: ResolvedOpenAiConfig): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  HttpClient.HttpClient
> => {
  const clientLayer = OpenAiCompatClient.layer({ apiKey, apiUrl: baseUrl });
  return OpenAiCompatLanguageModel.model(model).pipe(Layer.provide(clientLayer));
};

/** Builds an OpenAI Responses model layer while leaving the HTTP transport configurable. */
export const openAiLanguageModelLayer = ({
  apiKey,
  baseUrl,
  model,
}: OpenAiEndpoint): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  return openAiLanguageModelLayerResolved({
    apiKey: Redacted.make(apiKey),
    baseUrl,
    model,
  });
};

/** Builds an OpenAI-compatible Chat Completions model layer. */
export const openAiCompatLanguageModelLayer = ({
  apiKey,
  baseUrl,
  model,
}: OpenAiEndpoint): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  return openAiCompatLanguageModelLayerResolved({
    apiKey: Redacted.make(apiKey),
    baseUrl,
    model,
  });
};

/** Creates a base agent provider backed by the OpenAI Responses API and global `fetch`. */
const makeOpenAiImpl = Effect.fn("Agent.makeOpenAi")(function* (config: OpenAiConfig) {
  const resolved = yield* resolveConfig(config);
  const modelLayer = openAiLanguageModelLayerResolved(resolved).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
  return yield* make().pipe(Effect.provide(modelLayer));
});

export const makeOpenAi: (config: OpenAiConfig) => OpenAiAgent = makeOpenAiImpl;

/** Creates a base agent provider backed by an OpenAI-compatible API and global `fetch`. */
const makeOpenAiCompatImpl = Effect.fn("Agent.makeOpenAiCompat")(function* (config: OpenAiConfig) {
  const resolved = yield* resolveConfig(config);
  const modelLayer = openAiCompatLanguageModelLayerResolved(resolved).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
  return yield* make().pipe(Effect.provide(modelLayer));
});

export const makeOpenAiCompat: (config: OpenAiConfig) => OpenAiAgent = makeOpenAiCompatImpl;
