import { Agent, Sandbox } from "@open-insight/core";
import {
  Context,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Ref,
  Result,
  Scope,
  Stream,
} from "effect";
import { LanguageModel, Prompt, Response, Tool, Toolkit } from "effect/unstable/ai";
import * as Cli from "#/cli/index.ts";
import * as Mcp from "#/mcp/index.ts";
import type * as SkillsConfig from "#/skills/config.ts";
import * as Skills from "#/skills/index.ts";
import * as SandboxToolkit from "#/sandbox/index.ts";

type ToolkitServices<Tools extends Record<string, Tool.Any>> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

type ToolkitTools<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [typeof SandboxToolkit.toolkit, Toolkit.Toolkit<Tools>]
>;

type ToolsWithMcp<Tools extends Record<string, Tool.Any>> = Toolkit.MergedTools<
  readonly [typeof SandboxToolkit.toolkit, Toolkit.Toolkit<Tools>, Toolkit.Toolkit<Mcp.Tools>]
>;

export type Config<Tools extends Record<string, Tool.Any> = {}> = Readonly<{
  toolkit?: Toolkit.Toolkit<Tools>;
  skills?: SkillsConfig.Config;
  mcp?: ReadonlyArray<Mcp.Server>;
  cli?: ReadonlyArray<Cli.Cli>;
  maxSteps?: number;
}>;

const DEFAULT_MAX_STEPS = 32;

type LoopState = {
  usage: Response.Usage;
  trajectory: Prompt.Prompt;
};

type ProviderOptions = Readonly<{
  snapshot?: Agent.SnapshotExtension;
  instructions?: Option.Option<string>;
  cli?: ReadonlyArray<Cli.Cli>;
  maxSteps?: number;
}>;

const addOptional = (left: number | undefined, right: number | undefined) =>
  left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);

const emptyUsage = () => Response.Usage.make({ inputTokens: {}, outputTokens: {} });

const addUsage = (left: Response.Usage, right: Response.Usage) =>
  Response.Usage.make({
    inputTokens: {
      uncached: addOptional(left.inputTokens.uncached, right.inputTokens.uncached),
      total: addOptional(left.inputTokens.total, right.inputTokens.total),
      cacheRead: addOptional(left.inputTokens.cacheRead, right.inputTokens.cacheRead),
      cacheWrite: addOptional(left.inputTokens.cacheWrite, right.inputTokens.cacheWrite),
    },
    outputTokens: {
      total: addOptional(left.outputTokens.total, right.outputTokens.total),
      text: addOptional(left.outputTokens.text, right.outputTokens.text),
      reasoning: addOptional(left.outputTokens.reasoning, right.outputTokens.reasoning),
    },
  });

const joinInstructions = (...instructions: ReadonlyArray<Option.Option<string>>) => {
  const defined = instructions.flatMap(Option.toArray);
  return defined.length === 0 ? Option.none() : Option.some(defined.join("\n\n"));
};

const resolveMaxSteps = Effect.fn("Agent.resolveMaxSteps")(function* (maxSteps?: number) {
  if (maxSteps === undefined) {
    return DEFAULT_MAX_STEPS;
  }
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    return yield* Effect.fail(
      Agent.Error.stream(
        new RangeError(`maxSteps must be a positive safe integer, received ${maxSteps}`),
      ),
    );
  }
  return maxSteps;
});

const makeSession = Effect.fn("Agent.makeSession")(function* <
  Tools extends Record<string, Tool.Any>,
>({
  sandbox,
  toolkit,
  ctx,
  instructions,
  maxSteps,
}: {
  sandbox: Sandbox.Sandbox;
  toolkit: Toolkit.WithHandler<Tools>;
  ctx: Context.Context<ToolkitServices<Tools>>;
  instructions: Option.Option<string>;
  maxSteps: number;
}): Effect.fn.Return<Agent.Agent<Tools>, Agent.Error, LanguageModel.LanguageModel> {
  const llm = yield* LanguageModel.LanguageModel;
  const initialTrajectory = Option.match(instructions, {
    onNone: () => Prompt.empty,
    onSome: (instructions) => Prompt.make([{ role: "system", content: instructions }]),
  });
  const history = yield* Ref.make(initialTrajectory);

  const runLoop = (
    prompt: Prompt.RawInput,
    step: number,
    state: LoopState,
  ): Stream.Stream<
    Agent.StreamPart<Tools>,
    unknown,
    | LanguageModel.LanguageModel
    | Sandbox.Current
    | Tool.HandlerServices<Tools[keyof Tools]>
    | Tool.ResultDecodingServices<Tools[keyof Tools]>
  > =>
    Stream.suspend(() => {
      const nextTrajectory = Prompt.concat(state.trajectory, prompt);
      const responseParts: Array<Response.AnyPart> = [];
      let finalFinish: Response.FinishPart | undefined;
      let hasToolResult = false;
      const turn = LanguageModel.streamText({ prompt: nextTrajectory, toolkit }).pipe(
        Stream.filterMap((part) => {
          responseParts.push(part);
          if (
            part.type === "tool-result" &&
            part.providerExecuted === false &&
            part.preliminary === false
          ) {
            hasToolResult = true;
          }

          if (part.type !== "finish") {
            return Result.succeed(part);
          }

          state.usage = addUsage(state.usage, part.usage);
          if (!hasToolResult) {
            finalFinish = Response.makePart("finish", {
              reason: part.reason,
              usage: state.usage,
              response: part.response,
              metadata: part.metadata,
            });
          }
          return Result.failVoid;
        }),
      );
      const complete = Stream.fromEffect(
        Effect.sync(() => {
          const trajectory = Prompt.concat(nextTrajectory, Prompt.fromResponseParts(responseParts));
          state.trajectory = trajectory;
          return trajectory;
        }).pipe(Effect.tap((trajectory) => Ref.set(history, trajectory))),
      ).pipe(
        Stream.flatMap(() => {
          if (finalFinish !== undefined) {
            return Stream.succeed(finalFinish);
          }
          if (!hasToolResult) {
            return Stream.empty;
          }
          if (step >= maxSteps) {
            return Stream.fail(
              Agent.Error.stream(
                new Error(`Agent exceeded maxSteps (${maxSteps}) while resolving tool calls`),
              ),
            );
          }
          return runLoop(Prompt.empty, step + 1, state);
        }),
      );

      return Stream.concat(turn, complete);
    });

  return {
    trajectory: () => Ref.get(history),
    prompt: (prompt) =>
      Stream.unwrap(
        Ref.get(history).pipe(
          Effect.map((trajectory) =>
            runLoop(prompt, 1, {
              usage: emptyUsage(),
              trajectory,
            }),
          ),
        ),
      ).pipe(
        Stream.mapError(Agent.Error.stream),
        Stream.provideService(LanguageModel.LanguageModel, llm),
        Stream.provideService(Sandbox.Current, sandbox),
        Stream.provideContext(ctx),
      ),
  } satisfies Agent.Agent<Tools>;
});

const makeProvider = Effect.fn("Agent.makeProvider")(function* <
  Tools extends Record<string, Tool.Any>,
>(
  toolkit: Toolkit.Toolkit<Tools>,
  options?: ProviderOptions,
): Effect.fn.Return<
  Agent.Provider<Tools>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<Tools>
> {
  const llm = yield* LanguageModel.LanguageModel;
  const ctx = yield* Effect.context<ToolkitServices<Tools>>();
  const tools = yield* toolkit;
  const maxSteps = yield* resolveMaxSteps(options?.maxSteps);

  const runSession = Effect.fn("Agent.runSession")(
    function* (sandbox: Sandbox.Sandbox) {
      const cliInstructions = yield* Effect.transposeOption(
        Option.fromUndefinedOr(options?.cli).pipe(
          Option.map((cli) =>
            Cli.instructions(cli, sandbox).pipe(Effect.mapError(Agent.Error.stream)),
          ),
        ),
      ).pipe(Effect.map(Option.flatMap(Option.fromUndefinedOr)));

      return yield* makeSession({
        sandbox,
        toolkit: tools,
        ctx,
        instructions: joinInstructions(options?.instructions ?? Option.none(), cliInstructions),
        maxSteps,
      });
    },
    (effect) => effect.pipe(Effect.provideService(LanguageModel.LanguageModel, llm)),
  ) satisfies Agent.Provider<Tools>["runSession"];

  return {
    snapshotExtension: Option.fromUndefinedOr(options?.snapshot),
    runSession,
  } satisfies Agent.Provider<Tools>;
});

const makeCustom = Effect.fn("Agent.makeCustom")(function* <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  options?: { readonly cli?: ReadonlyArray<Cli.Cli>; readonly maxSteps?: number },
): Effect.fn.Return<
  Agent.Provider<ToolkitTools<Tools>>,
  Agent.Error,
  LanguageModel.LanguageModel | Tool.HandlersFor<Tools> | ToolkitServices<ToolkitTools<Tools>>
> {
  const combined = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  return yield* makeProvider(combined, options).pipe(Effect.provide(SandboxToolkit.layer));
});

const makeBase = Effect.fn("Agent.makeBase")(function* (options?: {
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): Effect.fn.Return<
  Agent.Provider<SandboxToolkit.Tools>,
  Agent.Error,
  LanguageModel.LanguageModel
> {
  return yield* makeCustom(Toolkit.empty, options);
});

const makeSkills = Effect.fn("Agent.makeSkills")(function* <
  Tools extends Record<string, Tool.Any>,
>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const base = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const skills = yield* Skills.prepare(config.skills);

  return yield* makeProvider(base, {
    snapshot: skills.snapshotExtension,
    instructions: Option.fromUndefinedOr(skills.systemInstructions),
    cli: config.cli,
    maxSteps: config.maxSteps,
  }).pipe(Effect.provide(SandboxToolkit.layer));
});

const makeMcp = Effect.fn("Agent.makeMcp")(function* <
  Tools extends Record<string, Tool.Any>,
>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly mcp: ReadonlyArray<Mcp.Server>;
  readonly snapshot?: Agent.SnapshotExtension;
  readonly instructions?: Option.Option<string>;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}) {
  const toolkit = config.toolkit ?? Toolkit.empty;
  const base = Toolkit.merge(SandboxToolkit.toolkit, toolkit);
  const mcp = yield* Mcp.make(config.mcp, {
    reservedNames: Object.keys(base.tools),
  });
  const combined = Toolkit.merge(base, mcp.toolkit);

  return yield* makeProvider(combined, {
    snapshot: config.snapshot,
    instructions: joinInstructions(
      config.instructions ?? Option.none(),
      Option.fromUndefinedOr(mcp.systemInstructions),
    ),
    cli: config.cli,
    maxSteps: config.maxSteps,
  }).pipe(
    Effect.provide([SandboxToolkit.layer, mcp.layer]),
    Effect.onError((cause) => mcp.close(Exit.failCause(cause))),
  );
});

const makeCombined = Effect.fn("Agent.makeCombined")(function* <
  Tools extends Record<string, Tool.Any>,
>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp: ReadonlyArray<Mcp.Server>;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}) {
  const skills = yield* Skills.prepare(config.skills);

  return yield* makeMcp({
    toolkit: config.toolkit,
    mcp: config.mcp,
    snapshot: skills.snapshotExtension,
    instructions: Option.fromUndefinedOr(skills.systemInstructions),
    cli: config.cli,
    maxSteps: config.maxSteps,
  });
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

type McpProvider<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolsWithMcp<Tools>>,
  Agent.Error | Mcp.Error,
  | LanguageModel.LanguageModel
  | Tool.HandlersFor<Tools>
  | ToolkitServices<ToolsWithMcp<Tools>>
  | Scope.Scope
>;

type Combined<Tools extends Record<string, Tool.Any>> = Effect.Effect<
  Agent.Provider<ToolsWithMcp<Tools>>,
  Agent.Error | Mcp.Error | Skills.Error,
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
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): Base;
export function make<Tools extends Record<string, Tool.Any>>(config: {
  readonly toolkit: Toolkit.Toolkit<Tools>;
  readonly skills?: undefined;
  readonly mcp?: undefined;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): Custom<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp?: undefined;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): Skilled<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills?: undefined;
  readonly mcp: ReadonlyArray<Mcp.Server>;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): McpProvider<Tools>;
export function make<Tools extends Record<string, Tool.Any> = {}>(config: {
  readonly toolkit?: Toolkit.Toolkit<Tools>;
  readonly skills: SkillsConfig.Config;
  readonly mcp: ReadonlyArray<Mcp.Server>;
  readonly cli?: ReadonlyArray<Cli.Cli>;
  readonly maxSteps?: number;
}): Combined<Tools>;
export function make<Tools extends Record<string, Tool.Any>>(config?: Config<Tools>) {
  if (config === undefined) {
    return makeBase();
  }
  if (config.skills === undefined) {
    if (config.mcp === undefined) {
      return config.toolkit === undefined
        ? makeBase({ cli: config.cli, maxSteps: config.maxSteps })
        : makeCustom(config.toolkit, { cli: config.cli, maxSteps: config.maxSteps });
    }
    return makeMcp({
      toolkit: config.toolkit,
      mcp: config.mcp,
      cli: config.cli,
      maxSteps: config.maxSteps,
    });
  }
  if (config.mcp === undefined) {
    return makeSkills({
      toolkit: config.toolkit,
      skills: config.skills,
      cli: config.cli,
      maxSteps: config.maxSteps,
    });
  }
  return makeCombined({
    toolkit: config.toolkit,
    skills: config.skills,
    mcp: config.mcp,
    cli: config.cli,
    maxSteps: config.maxSteps,
  });
}
