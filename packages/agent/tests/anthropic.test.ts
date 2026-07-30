import { assert, it } from "@effect/vitest";
import { Config, Effect, Layer, Option } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import {
  anthropicLayer,
  makeAnthropic,
  type AnthropicConfig,
  type AnthropicEndpoint,
} from "#/provider/anthropic.ts";

const endpoint: AnthropicEndpoint = {
  apiKey: "test-key",
  baseUrl: "https://example.test",
  model: "test-model",
};

const config: AnthropicConfig = {
  apiKey: Config.string("TEST_ANTHROPIC_API_KEY"),
  baseUrl: Config.string("TEST_ANTHROPIC_BASE_URL"),
  dotenvPath: new URL("./fixtures/anthropic.env", import.meta.url).pathname,
  model: "test-model",
};

it.effect("creates an Anthropic Messages agent from endpoint values", () =>
  Effect.gen(function* () {
    const provider = yield* makeAnthropic(config);
    const urls: Array<string> = [];
    const fetch: typeof globalThis.fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.reject(new Error("request captured"));
    };

    yield* LanguageModel.generateText({ prompt: "hello" }).pipe(
      Effect.provide(anthropicLayer(endpoint).pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.exit,
    );

    assert.isTrue(Option.isNone(provider.snapshotExtension));
    assert.strictEqual(urls[0], `${endpoint.baseUrl}/v1/messages?beta=true`);
  }),
);
