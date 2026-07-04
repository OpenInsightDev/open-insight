import { Chat, LanguageModel, Response, Toolkit } from "effect/unstable/ai";
import { Effect, Option, Ref, Stream } from "effect";
import * as Agent from "@/agent/index.ts";
import * as Sandbox from "@/sandbox/index.ts";

const randomText = Effect.fn(function* () {
  return yield* Effect.sync(() => crypto.randomUUID().replaceAll("-", ""));
});

const finishPart: Response.FinishPartEncoded = {
  type: "finish",
  reason: "stop",
  usage: {
    inputTokens: {
      uncached: 0,
      total: 0,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 0,
      text: undefined,
      reasoning: undefined,
    },
  },
  response: undefined,
};

const makeDummyLanguageModel = Effect.fn(function* () {
  return yield* LanguageModel.make({
    generateText: () =>
      randomText().pipe(Effect.map((text) => [{ type: "text", text }, finishPart])),
    streamText: () =>
      Stream.unwrap(
        randomText().pipe(
          Effect.map((text) =>
            Stream.fromIterable([
              { type: "text-start", id: "dummy" } as const,
              { type: "text-delta", id: "dummy", delta: text } as const,
              { type: "text-end", id: "dummy" } as const,
              finishPart,
            ]),
          ),
        ),
      ),
  });
});

type EmptyToolkit = Toolkit.Toolkit<{}>;

export const makeAgent = Effect.fn(function* ({
  chat = Chat.empty,
  toolkit = Toolkit.empty,
}: {
  chat?: Effect.Effect<Chat.Service>;
  toolkit?: EmptyToolkit;
}): Effect.fn.Return<Agent.Agent, Agent.AgentError, never> {
  const llm = yield* makeDummyLanguageModel();
  const service = yield* chat;

  return {
    trajectory: () => Ref.get(service.history),
    prompt: ({ prompt }) =>
      Effect.succeed(
        service
          .streamText({ prompt, toolkit })
          .pipe(
            Stream.mapError(Agent.AgentError.stream),
            Stream.provideService(LanguageModel.LanguageModel, llm),
          ),
      ),
  } satisfies Agent.Agent;
});

export const make = Effect.fn(function* ({
  chat = Chat.empty,
  toolkit = Toolkit.empty,
}: {
  chat?: Effect.Effect<Chat.Service>;
  toolkit?: EmptyToolkit;
}): Effect.fn.Return<Agent.Provider, Agent.AgentError, never> {
  const llm = yield* makeDummyLanguageModel();

  const runSession = Effect.fn(
    function* ({ sandbox: _sandbox }: { sandbox: Sandbox.Sandbox }) {
      return yield* makeAgent({ chat, toolkit });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider["runSession"];

  return {
    snapshotExtension: Option.none(),
    runSession,
  } satisfies Agent.Provider;
});
