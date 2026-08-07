import * as OpenAI from "@effect/ai-openai";
import * as OpenAICompat from "@effect/ai-openai-compat";
import { Layer } from "effect";
import type { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import type { Config } from "./config.ts";

export const openaiLayer = ({
  apiKey,
  baseUrl,
  model,
}: Config): Layer.Layer<LanguageModel.LanguageModel> => {
  const client = OpenAI.OpenAiClient.layer({ apiKey, apiUrl: baseUrl });
  return OpenAI.OpenAiLanguageModel.model(model)
    .pipe(Layer.provide(client))
    .pipe(Layer.provide(FetchHttpClient.layer));
};

export const openaiCompatLayer = ({
  apiKey,
  baseUrl,
  model,
}: Config): Layer.Layer<LanguageModel.LanguageModel> => {
  const client = OpenAICompat.OpenAiClient.layer({ apiKey, apiUrl: baseUrl });
  return OpenAICompat.OpenAiLanguageModel.model(model)
    .pipe(Layer.provide(client))
    .pipe(Layer.provide(FetchHttpClient.layer));
};

export const openaiLayerWithClient = ({
  model,
}: Pick<Config, "model">): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  OpenAI.OpenAiClient.OpenAiClient
> => OpenAI.OpenAiLanguageModel.layer({ model });

export const openaiCompatLayerWithClient = ({
  model,
}: Pick<Config, "model">): Layer.Layer<
  LanguageModel.LanguageModel,
  never,
  OpenAICompat.OpenAiClient.OpenAiClient
> => OpenAICompat.OpenAiLanguageModel.layer({ model });
