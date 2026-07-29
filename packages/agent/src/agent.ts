import { Agent, Sandbox } from "@open-insight/core";
import { Context, Effect, Exit, FileSystem, Option, Path, Ref, Scope, Stream } from "effect";
import { Chat, LanguageModel, Tool, Toolkit } from "effect/unstable/ai";
import type * as McpConfig from "#/mcp/config.ts";
import type { Error as McpError } from "#/mcp/error.ts";
import * as McpToolkit from "#/mcp/toolkit.ts";
import type * as SkillsConfig from "#/skills/config.ts";
import * as Skills from "#/skills/index.ts";
import * as SandboxToolkit from "#/toolkit.ts";

type ToolkitServices<Tools extends Record<string, Tool.Any>> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

type ToolkitTools<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [typeof SandboxToolkit.toolkit, Toolkit.Toolkit<Tools>]
>;

type ToolsWithMcp<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
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

const joinInstructions = (...instructions: ReadonlyArray<string | undefined>) => {
  const defined = instructions.filter((instruction) => instruction !== undefined);
  return defined.length === 0 ? undefined : defined.join("\n\n");
};

const makeSession = Effect.fn(function* <Tools extends Record<string, Tool.Any>>({
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
  const chat = yield* Option.match(systemInstructions, {
    onNone: () => Chat.empty,
    onSome: (instructions) => Chat.fromPrompt([{ role: "system", content: instructions }]),
  });

  return {
    trajectory: () => Ref.get(chat.history),
    prompt: (prompt) =>
      chat
        .streamText({ prompt, toolkit })
        .pipe(
          Stream.mapError(Agent.Error.stream),
          Stream.provideService(LanguageModel.LanguageModel, llm),
          Stream.provideService(Sandbox.Current, sandbox),
          Stream.provideContext(toolkitContext),
        ),
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
  const configured = yield* toolkit;

  const runSession = Effect.fn(
    function* (sandbox: Sandbox.Sandbox) {
      return yield* makeSession({
        sandbox,
        toolkit: configured,
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

const makeCustom = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.fn.Return<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolkitTools<Tools>>
> {
  const combinedToolkit = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  return yield* makeProvider(combinedToolkit).pipe(Effect.provide(SandboxToolkit.layer));
});

const makeBase = Effect.fn(function* (): Effect.fn.Return<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
> {
  return yield* makeCustom(Toolkit.empty);
});

const makeSkills = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
}) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const base = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const skills = yield* Skills.prepare(config.skills);

  return yield* makeProvider(base, {
    snapshotExtension: skills.snapshotExtension,
    systemInstructions: skills.systemInstructions,
  }).pipe(Effect.provide(SandboxToolkit.layer));
});

const makeMcp = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly mcp: ReadonlyArray<McpConfig.Server>;
}) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const base = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const mcp = yield* McpToolkit.make(config.mcp, {
    reservedNames: Object.keys(base.tools),
  });
  const combined = Toolkit.merge(base, mcp.toolkit);

  return yield* makeProvider(combined, {
    systemInstructions: mcp.systemInstructions,
  }).pipe(
    Effect.provide(SandboxToolkit.layer),
    Effect.provide(mcp.layer),
    Effect.onError((cause) => mcp.close(Exit.failCause(cause))),
  );
});

const makeCombined = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp: ReadonlyArray<McpConfig.Server>;
}) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const base = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const skills = yield* Skills.prepare(config.skills);
  const mcp = yield* McpToolkit.make(config.mcp, {
    reservedNames: Object.keys(base.tools),
  });
  const combined = Toolkit.merge(base, mcp.toolkit);

  return yield* makeProvider(combined, {
    snapshotExtension: skills.snapshotExtension,
    systemInstructions: joinInstructions(skills.systemInstructions, mcp.systemInstructions),
  }).pipe(
    Effect.provide(SandboxToolkit.layer),
    Effect.provide(mcp.layer),
    Effect.onError((cause) => mcp.close(Exit.failCause(cause))),
  );
});

type Base = Effect.Effect<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
>;

type Custom<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolkitTools<Tools>>
>;

type Skilled<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error | Skills.Error,
  | LanguageModel.LanguageModel
  | Tool.HandlersFor<Tools>
  | ToolkitServices<ToolkitTools<Tools>>
  | FileSystem.FileSystem
  | Path.Path
>;

type Mcp<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolsWithMcp<Tools>>,
  Agent.Error | McpError,
  | LanguageModel.LanguageModel
  | Tool.HandlersFor<Tools>
  | ToolkitServices<ToolsWithMcp<Tools>>
  | Scope.Scope
>;

type Combined<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolsWithMcp<Tools>>,
  Agent.Error | McpError | Skills.Error,
  | LanguageModel.LanguageModel
  | Tool.HandlersFor<Tools>
  | ToolkitServices<ToolsWithMcp<Tools>>
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope
>;

export function make(): Base;
export function make(config: {
  readonly toolkit?: undefined;
  readonly skills?: undefined;
  readonly mcp?: undefined;
}): Base;
export function make<Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit: Toolkit.Toolkit<Tools>;
  readonly skills?: undefined;
  readonly mcp?: undefined;
}): Custom<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp?: undefined;
}): Skilled<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills?: undefined;
  readonly mcp: ReadonlyArray<McpConfig.Server>;
}): Mcp<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp: ReadonlyArray<McpConfig.Server>;
}): Combined<Tools>;
export function make<Tools extends Record<string, Tool.Any>>(config?: Config<Tools>) {
  if (config === undefined) {
    return makeBase();
  }
  if (config.skills === undefined) {
    if (config.mcp === undefined) {
      return config.toolkit === undefined ? makeBase() : makeCustom(config.toolkit);
    }
    return makeMcp({ toolkit: config.toolkit, mcp: config.mcp });
  }
  if (config.mcp === undefined) {
    return makeSkills({ toolkit: config.toolkit, skills: config.skills });
  }
  return makeCombined({
    toolkit: config.toolkit,
    skills: config.skills,
    mcp: config.mcp,
  });
}
