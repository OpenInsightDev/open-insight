import * as Agent from "#/agent/index.ts";
import { Error } from "#/agent/error.ts";
import * as Sandbox from "#/sandbox/index.ts";
import { Context, Effect, Option, Ref, Stream } from "effect";
import { Chat, LanguageModel, Tool, Toolkit } from "effect/unstable/ai";
import * as SandboxToolkit from "./toolkit.ts";

type ToolkitServices<Tools extends Record<string, Tool.Any>> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

export type ToolsWithSandbox<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [typeof SandboxToolkit.toolkit, Toolkit.Toolkit<Tools>]
>;

const makeAgent = Effect.fn(function* <Tools extends Record<string, Tool.Any>>({
  sandbox,
  toolkit,
  toolkitContext,
}: {
  sandbox: Sandbox.Sandbox;
  toolkit: Toolkit.WithHandler<Tools>;
  toolkitContext: Context.Context<ToolkitServices<Tools>>;
}): Effect.fn.Return<Agent.Agent<Tools>, Agent.Error, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;
  const chat = yield* Chat.empty;

  return {
    trajectory: () => Ref.get(chat.history),
    prompt: (prompt) =>
      chat
        .streamText({ prompt, toolkit })
        .pipe(
          Stream.mapError(Error.stream),
          Stream.provideService(LanguageModel.LanguageModel, llm),
          Stream.provideService(Sandbox.Current, sandbox),
          Stream.provideContext(toolkitContext),
        ),
  } satisfies Agent.Agent<Tools>;
});

const makeProvider = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.fn.Return<
  Agent.Provider<Tools>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<Tools>
> {
  const llm = yield* LanguageModel.LanguageModel;
  const toolkitContext = yield* Effect.context<ToolkitServices<Tools>>();
  const configuredToolkit = yield* toolkit;

  const runSession = Effect.fn(
    function* (sandbox: Sandbox.Sandbox) {
      return yield* makeAgent({
        sandbox,
        toolkit: configuredToolkit,
        toolkitContext,
      });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider<Tools>["runSession"];

  return {
    snapshotExtension: Option.none(),
    runSession,
  } satisfies Agent.Provider<Tools>;
});

export const makeWithToolkit = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.fn.Return<
  Agent.Provider<ToolsWithSandbox<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolsWithSandbox<Tools>>
> {
  const combinedToolkit = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  return yield* makeProvider(combinedToolkit).pipe(Effect.provide(SandboxToolkit.layer));
});

export const make = Effect.fn(function* (): Effect.fn.Return<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
> {
  return yield* makeWithToolkit(Toolkit.empty);
});
