import { assert, it } from "@effect/vitest";
import { Config, Effect, Layer, Option, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import {
  makeOpenAi,
  makeOpenAiCompat,
  openAiCompatLayer,
  openAiLayer,
  type OpenAiConfig,
  type OpenAiEndpoint,
} from "#/provider/openai.ts";
import { layer as sandboxLayer, toolkit as sandboxToolkit } from "#/sandbox/index.ts";

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

const requestUrl = (layer: ReturnType<typeof openAiLayer>) =>
  Effect.gen(function* () {
    const urls: Array<string> = [];
    const fetch: typeof globalThis.fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.reject(new Error("request captured"));
    };

    yield* LanguageModel.generateText({ prompt: "hello" }).pipe(
      Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.exit,
    );

    return urls[0];
  });

it.effect("creates an OpenAI Responses agent from endpoint values", () =>
  Effect.gen(function* () {
    const provider = yield* makeOpenAi(config);

    assert.isTrue(Option.isNone(provider.snapshotExtension));
    assert.strictEqual(yield* requestUrl(openAiLayer(endpoint)), `${endpoint.baseUrl}/responses`);
  }),
);

it.effect("creates an OpenAI-compatible agent from endpoint values", () =>
  Effect.gen(function* () {
    const provider = yield* makeOpenAiCompat(config);

    assert.isTrue(Option.isNone(provider.snapshotExtension));
    assert.strictEqual(
      yield* requestUrl(openAiCompatLayer(endpoint)),
      `${endpoint.baseUrl}/chat/completions`,
    );
  }),
);

it.effect("decodes OpenAI-compatible streamed tool parameters before toolkit validation", () =>
  Effect.gen(function* () {
    const toolArguments = JSON.stringify({ command: "env", env: [] });
    const chunk = {
      id: "chatcmpl-env",
      object: "chat.completion.chunk",
      model: endpoint.model,
      created: 1,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-env",
                type: "function",
                function: { name: "Execute", arguments: toolArguments },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const body = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

    const parts = yield* LanguageModel.streamText({
      prompt: "Inspect the environment",
      toolkit: sandboxToolkit,
      disableToolCallResolution: true,
    }).pipe(
      Stream.runCollect,
      Effect.provide(sandboxLayer),
      Effect.provide(openAiCompatLayer(endpoint).pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
    const toolCall = Array.from(parts).find((part) => part.type === "tool-call");

    assert.isDefined(toolCall);
    if (toolCall?.type === "tool-call") {
      assert.deepStrictEqual(toolCall.params, { command: "env", env: {} });
    }
  }),
);

it.effect("decodes OpenAI-compatible tool parameters before toolkit validation", () =>
  Effect.gen(function* () {
    const payload = {
      id: "chatcmpl-env",
      object: "chat.completion",
      model: endpoint.model,
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-env",
                type: "function",
                function: {
                  name: "Execute",
                  arguments: JSON.stringify({ command: "env", env: [] }),
                },
              },
            ],
          },
        },
      ],
    };
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = yield* LanguageModel.generateText({
      prompt: "Inspect the environment",
      toolkit: sandboxToolkit,
      disableToolCallResolution: true,
    }).pipe(
      Effect.provide(sandboxLayer),
      Effect.provide(openAiCompatLayer(endpoint).pipe(Layer.provide(FetchHttpClient.layer))),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
    const toolCall = response.content.find((part) => part.type === "tool-call");

    assert.isDefined(toolCall);
    if (toolCall?.type === "tool-call") {
      assert.deepStrictEqual(toolCall.params, { command: "env", env: {} });
    }
  }),
);
