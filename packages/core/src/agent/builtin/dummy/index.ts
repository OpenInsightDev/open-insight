import * as Agent from "#/agent/index.ts";
import { Effect, Stream } from "effect";
import { LanguageModel, Response, Tool } from "effect/unstable/ai";
import * as EffectAgent from "../effect/index.ts";
import * as SandboxToolkit from "../effect/toolkit.ts";

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

const toolCall = <T extends Tool.Any>(
  tool: T,
  id: string,
  params: Tool.ParametersEncoded<T>,
): Response.ToolCallPartEncoded => ({
  type: "tool-call",
  id,
  name: tool.name,
  params,
});

const toolCalls = [
  toolCall(SandboxToolkit.WriteFile, "dummy-write-file", {
    sandboxPath: "/tmp/open-insight-dummy.txt",
    content: "open-insight dummy agent",
  }),
  toolCall(SandboxToolkit.ReadFile, "dummy-read-file", { sandboxPath: "/etc/hosts" }),
  toolCall(SandboxToolkit.Execute, "dummy-execute", {
    command: "printf",
    args: ["open-insight dummy agent"],
  }),
];

const makeDummyLanguageModel = Effect.fn(function* () {
  return yield* LanguageModel.make({
    generateText: () =>
      randomText().pipe(
        Effect.map((text) => [...toolCalls, { type: "text", text } as const, finishPart]),
      ),
    streamText: () =>
      Stream.unwrap(
        randomText().pipe(
          Effect.map((text) =>
            Stream.fromIterable([
              ...toolCalls,
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

export const make = Effect.fn(function* (): Effect.fn.Return<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  never
> {
  const llm = yield* makeDummyLanguageModel();
  return yield* EffectAgent.make().pipe(Effect.provideService(LanguageModel.LanguageModel, llm));
});
