import { assert, it } from "@effect/vitest";
import { Config, Effect, Layer, Option } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import {
  makeOpenAi,
  makeOpenAiCompat,
  openAiCompatLanguageModelLayer,
  openAiLanguageModelLayer,
  type OpenAiConfig,
  type OpenAiEndpoint,
} from "#/openai.ts";

const endpoint: OpenAiEndpoint = {
  apiKey: "test-key",
  baseUrl: "https://example.test/v1",
  model: "test-model",
};

const config: OpenAiConfig = {
  apiKey: Config.string("TEST_OPENAI_API_KEY"),
  baseUrl: Config.string("TEST_OPENAI_BASE_URL"),
  dotenvPath: new URL("./fixtures/openai.env", import.meta.url).pathname,
  model: "test-model",
};

const requestUrl = (modelLayer: ReturnType<typeof openAiLanguageModelLayer>) =>
  Effect.gen(function* () {
    const urls: Array<string> = [];
    const fetch: typeof globalThis.fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.reject(new Error("request captured"));
    };

    yield* LanguageModel.generateText({ prompt: "hello" }).pipe(
      Effect.provide(modelLayer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.exit,
    );

    return urls[0];
  });

it.effect("creates an OpenAI Responses agent from endpoint values", () =>
  Effect.gen(function* () {
    const provider = yield* makeOpenAi(config);

    assert.isTrue(Option.isNone(provider.snapshotExtension));
    assert.strictEqual(
      yield* requestUrl(openAiLanguageModelLayer(endpoint)),
      `${endpoint.baseUrl}/responses`,
    );
  }),
);

it.effect("creates an OpenAI-compatible agent from endpoint values", () =>
  Effect.gen(function* () {
    const provider = yield* makeOpenAiCompat(config);

    assert.isTrue(Option.isNone(provider.snapshotExtension));
    assert.strictEqual(
      yield* requestUrl(openAiCompatLanguageModelLayer(endpoint)),
      `${endpoint.baseUrl}/chat/completions`,
    );
  }),
);
