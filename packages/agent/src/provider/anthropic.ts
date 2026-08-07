import * as Anthropic from "@effect/ai-anthropic";
import { Layer } from "effect";
import type { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import type { Config } from "./config.ts";

export const anthropicLayer = ({
  apiKey,
  baseUrl,
  model,
}: Config): Layer.Layer<LanguageModel.LanguageModel> => {
  const client = Anthropic.AnthropicClient.layer({ apiKey, apiUrl: baseUrl });
  return Anthropic.AnthropicLanguageModel.model(model)
    .pipe(Layer.provide(client))
    .pipe(Layer.provide(FetchHttpClient.layer));
};

export const anthropicLayerWithClient = ({
  model,
}: Pick<Config, "model">): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  Anthropic.AnthropicClient.AnthropicClient
> => Anthropic.AnthropicLanguageModel.layer({ model });
