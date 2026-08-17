import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Context, Effect, Layer, Ref, Semaphore, Stream } from "effect";
import { LanguageModel, Response, Tool, Toolkit } from "effect/unstable/ai";
import * as Ctx from "#/context/index.ts";
import { AgentError } from "./error.ts";

export type AnyTools = Record<string, Tool.Any>;

type ToolkitServices<Tools extends AnyTools> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

export type Session<Tools extends AnyTools> = Readonly<{
  toolkit: Toolkit.WithHandler<Tools>;
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPart<Tools>, AgentError>;
}>;

type Agent = Readonly<{
  createSession<Tools extends AnyTools>(
    toolkit: Toolkit.Toolkit<Tools>,
  ): Effect.Effect<
    Session<Tools>,
    AgentError,
    LanguageModel.LanguageModel | Sandbox.Current | Tool.HandlersFor<Tools> | ToolkitServices<Tools>
  >;
}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {}

const TrajectoryRef = Context.Reference("Trajectory", {
  defaultValue: () => Prompt.empty,
});

const makeSession = Effect.fn(function* <Tools extends AnyTools>(
  //   {
  //   toolkit,
  //   history,
  //   ctx,
  //   sandbox,
  //   llm,
  //   services,
  // }: {
  //   toolkit: Toolkit.WithHandler<Tools>;
  //   history: Ref.Ref<Prompt.Prompt>;
  //   ctx: Ctx.ContextManagement;
  //   sandbox: Sandbox.Sandbox;
  //   llm: LanguageModel.Service;
  //   services: Context.Context<ToolkitServices<Tools>>;
  // }
  {
    trajectoryRef,
    Toolkit,
  }: {
    trajectoryRef: Ref.Ref<Prompt.Trajectory>;
    Toolkit: Toolkit.Toolkit<Tools>;
  },
) {
  const toolkit = yield* Toolkit;
  const ctx = yield* Ctx.Service;
  const llm = yield* LanguageModel.LanguageModel;
  const sandbox = yield* Sandbox.Current;
  const semaphore = Semaphore.makeUnsafe(1);

  const prompt = Effect.fn(
    function* (prompt: Prompt.Prompt) {
      yield* semaphore.take(1);

      const trajectory = yield* Ref.get(trajectoryRef);
      const pre = yield* ctx.applyPrePrompt({ ...sandbox, trajectory, prompt });
      yield* Ref.set(trajectoryRef, pre.trajectory);

      const fullPrompt = Prompt.concat(pre.trajectory, pre.prompt);

      const parts: Array<Response.AnyPart> = [];

      return LanguageModel.streamText({ prompt: fullPrompt, toolkit }).pipe(
        Stream.tap((part) =>
          Effect.sync(() => {
            parts.push(part);
          }),
        ),

        Stream.ensuring(
          Effect.gen(function* () {
            const after = yield* ctx.applyAfterRespond({
              ...sandbox,
              trajectory: fullPrompt,
              responded: Prompt.fromResponseParts(parts),
            });
            yield* Ref.set(trajectoryRef, Prompt.concat(after.trajectory, after.responded));
          }).pipe(
            // The stream has already terminated when this finalizer runs, so a
            // middleware failure cannot surface through the stream's error
            // channel; raise it as a defect instead of dropping it silently.
            Effect.orDie,
            Effect.ensuring(semaphore.release(1)),
          ),
        ),
        Stream.withSpan("Agent.prompt", { captureStackTrace: false }),
      );
    },
    (eff) =>
      eff.pipe(
        Stream.unwrap,
        Stream.mapError(AgentError.stream),
        Stream.provideService(LanguageModel.LanguageModel, llm),
        Stream.provideService(Sandbox.Current, sandbox),
      ),
  );

  return {
    toolkit,
    trajectory: trajectoryRef,
    prompt,
  } satisfies Session<Tools>;
});

export const layerFrom = (): Layer.Layer<Service, never, Ctx.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      return {
        createSession: <Tools extends AnyTools>(toolkit: Toolkit.Toolkit<Tools>) => {
          throw new Error("Not implemented");
        },
      };
    }),
  );
