import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
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

export type AnthropicConfig = ProviderConfig;

export type AnthropicEndpoint = Endpoint;

type AnthropicAgent = Effect.Effect<
  Agent.Provider<AgentTools<{}>>,
  Agent.Error | Mcp.Error | Config.ConfigError | PlatformError.PlatformError
>;

const modelLayer = ({
  apiKey,
  baseUrl,
  model,
}: ResolvedConfig): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  const client = AnthropicClient.layer({ apiKey, apiUrl: baseUrl });
  return AnthropicLanguageModel.model(model).pipe(Layer.provide(client));
};

/** Builds an Anthropic Messages model layer while leaving the HTTP transport configurable. */
export const anthropicLayer = ({
  apiKey,
  baseUrl,
  model,
}: AnthropicEndpoint): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> => {
  return modelLayer({
    apiKey: Redacted.make(apiKey),
    baseUrl,
    model,
  });
};

/** Creates a base agent provider backed by the Anthropic Messages API and global `fetch`. */
const makeAnthropicFn = Effect.fn("Agent.makeAnthropic")(function* (config: AnthropicConfig) {
  const resolved = yield* resolveConfig(config);
  const layer = modelLayer(resolved).pipe(Layer.provide(FetchHttpClient.layer));
  return yield* make(Toolkit.empty).pipe(Effect.provide(layer));
});

export const makeAnthropic: (config: AnthropicConfig) => AnthropicAgent = makeAnthropicFn;
