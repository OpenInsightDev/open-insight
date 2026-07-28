import { Agent, Sandbox } from "@open-insight/core";
import { Context, Effect, FileSystem, Option, Path, Ref, Scope, Stream } from "effect";
import { Chat, LanguageModel, Prompt, Tool, Toolkit } from "effect/unstable/ai";
import type * as McpConfig from "./mcp/config.ts";
import type { Error as McpError } from "./mcp/error.ts";
import * as McpToolkit from "./mcp/toolkit.ts";
import type * as SkillsConfig from "./skills/config.ts";
import * as Skills from "./skills/index.ts";
import * as SandboxToolkit from "./toolkit.ts";

type ToolkitServices<Tools extends Record<string, Tool.Any>> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

type ToolkitTools<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [typeof SandboxToolkit.toolkit, Toolkit.Toolkit<Tools>]
>;

export type ConfiguredTools<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [
    typeof SandboxToolkit.toolkit,
    Toolkit.Toolkit<Tools>,
    Toolkit.Toolkit<McpToolkit.Tools>,
  ]
>;

export type Config<Tools extends Record<string, Tool.Any> = {}> = Readonly<{
  toolkit?: Toolkit.Toolkit<Tools>;
  skills?: SkillsConfig.Config;
  mcp?: ReadonlyArray<McpConfig.Server>;
}>;

const makeAgent = Effect.fn(function* <Tools extends Record<string, Tool.Any>>({
  sandbox,
  toolkit,
  toolkitContext,
  systemInstructions,
}: {
  sandbox: Sandbox.Sandbox;
  toolkit: Toolkit.WithHandler<Tools>;
  toolkitContext: Context.Context<ToolkitServices<Tools>>;
  systemInstructions: Option.Option<string>;
}): Effect.fn.Return<Agent.Agent<Tools>, Agent.Error, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;
  const chat = yield* Chat.empty;

  return {
    trajectory: () => Ref.get(chat.history),
    prompt: (prompt) => {
      const configuredPrompt = Option.match(systemInstructions, {
        onNone: () => prompt,
        onSome: (instructions) => Prompt.prependSystem(prompt, instructions),
      });
      return chat
        .streamText({ prompt: configuredPrompt, toolkit })
        .pipe(
          Stream.mapError(Agent.Error.stream),
          Stream.provideService(LanguageModel.LanguageModel, llm),
          Stream.provideService(Sandbox.Current, sandbox),
          Stream.provideContext(toolkitContext),
        );
    },
  } satisfies Agent.Agent<Tools>;
});

const makeProvider = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  options?: {
    readonly snapshotExtension?: Agent.SnapshotExtension;
    readonly systemInstructions?: string;
  },
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
        systemInstructions: Option.fromUndefinedOr(options?.systemInstructions),
      });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider<Tools>["runSession"];

  return {
    snapshotExtension: Option.fromUndefinedOr(options?.snapshotExtension),
    runSession,
  } satisfies Agent.Provider<Tools>;
});

const makeToolkit = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.fn.Return<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolkitTools<Tools>>
> {
  const combinedToolkit = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  return yield* makeProvider(combinedToolkit).pipe(Effect.provide(SandboxToolkit.layer));
});

const makeDefault = Effect.fn(function* (): Effect.fn.Return<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
> {
  return yield* makeToolkit(Toolkit.empty);
});

const makeConfigured = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  config: Config<Tools>,
) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const baseToolkit = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const mcp = yield* McpToolkit.make(config.mcp ?? [], {
    reservedToolNames: Object.keys(baseToolkit.tools),
  });
  const combinedToolkit = Toolkit.merge(baseToolkit, mcp.toolkit);
  const skills = config.skills === undefined ? undefined : yield* Skills.prepare(config.skills);

  return yield* makeProvider(combinedToolkit, {
    snapshotExtension: skills?.snapshotExtension,
    systemInstructions: skills?.systemInstructions,
  }).pipe(Effect.provide(SandboxToolkit.layer), Effect.provide(mcp.layer));
});

type DefaultAgent = Effect.Effect<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
>;

type ToolkitAgent<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolkitTools<Tools>>
>;

type ConfiguredAgent<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ConfiguredTools<Tools>>,
  Agent.Error | McpError | Skills.Error,
  | LanguageModel.LanguageModel
  | Tool.HandlersFor<Tools>
  | ToolkitServices<ConfiguredTools<Tools>>
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope
>;

export function make(): DefaultAgent;
export function make<Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit: Toolkit.Toolkit<Tools>;
  readonly skills?: undefined;
  readonly mcp?: undefined;
}): ToolkitAgent<Tools>;
export function make<Tools extends Record<string, Tool.Any>>(
  config: Config<Tools>,
): ConfiguredAgent<Tools>;
export function make<Tools extends Record<string, Tool.Any>>(config?: Config<Tools>) {
  if (config === undefined) {
    return makeDefault();
  }
  if (config.skills === undefined && config.mcp === undefined) {
    return config.toolkit === undefined ? makeDefault() : makeToolkit(config.toolkit);
  }
  return makeConfigured(config);
}
