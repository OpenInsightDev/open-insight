import {
  OpenAiClient as CompatClient,
  OpenAiLanguageModel as CompatModel,
} from "@effect/ai-openai-compat";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import type { Agent } from "@open-insight/core";
import { Config, Effect, Layer, Redacted } from "effect";
import type { PlatformError } from "effect";
import { LanguageModel, Toolkit } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { make } from "#/agent/index.ts";
import type { Tools as AgentTools } from "#/agent/index.ts";
import type * as Mcp from "#/mcp/index.ts";
import type { Config as ProviderConfig, Endpoint, ResolvedConfig } from "#/provider/config.ts";
import { resolveConfig } from "#/provider/config.ts";

export type OpenAiConfig = ProviderConfig;

export type OpenAiEndpoint = Endpoint;

type OpenAiAgent = Effect.Effect<
  Agent.Provider<AgentTools<{}>>,
  Agent.Error | Mcp.Error | Config.ConfigError | PlatformError.PlatformError
>;

const modelLayer = ({
  apiKey,
  baseUrl,
  model,
}: ResolvedConfig): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  const client = OpenAiClient.layer({ apiKey, apiUrl: baseUrl });
  return OpenAiLanguageModel.model(model).pipe(Layer.provide(client));
};

const compatModelLayer = ({
  apiKey,
  baseUrl,
  model,
}: ResolvedConfig): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  const client = CompatClient.layer({ apiKey, apiUrl: baseUrl });
  return CompatModel.model(model).pipe(Layer.provide(client));
};

/** Builds an OpenAI Responses model layer while leaving the HTTP transport configurable. */
export const openAiLayer = ({
  apiKey,
  baseUrl,
  model,
}: OpenAiEndpoint): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  return modelLayer({
    apiKey: Redacted.make(apiKey),
    baseUrl,
    model,
  });
};

/** Builds an OpenAI-compatible Chat Completions model layer. */
export const openAiCompatLayer = ({
  apiKey,
  baseUrl,
  model,
}: OpenAiEndpoint): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  return compatModelLayer({
    apiKey: Redacted.make(apiKey),
    baseUrl,
    model,
  });
};

/** Creates a base agent provider backed by the OpenAI Responses API and global `fetch`. */
const makeOpenAiFn = Effect.fn("Agent.makeOpenAi")(function* (config: OpenAiConfig) {
  const resolved = yield* resolveConfig(config);
  const layer = modelLayer(resolved).pipe(Layer.provide(FetchHttpClient.layer));
  return yield* make(Toolkit.empty).pipe(Effect.provide(layer));
});

export const makeOpenAi: (config: OpenAiConfig) => OpenAiAgent = makeOpenAiFn;

/** Creates a base agent provider backed by an OpenAI-compatible API and global `fetch`. */
const makeCompatFn = Effect.fn("Agent.makeOpenAiCompat")(function* (config: OpenAiConfig) {
  const resolved = yield* resolveConfig(config);
  const layer = compatModelLayer(resolved).pipe(Layer.provide(FetchHttpClient.layer));
  return yield* make(Toolkit.empty).pipe(Effect.provide(layer));
});

export const makeOpenAiCompat: (config: OpenAiConfig) => OpenAiAgent = makeCompatFn;
