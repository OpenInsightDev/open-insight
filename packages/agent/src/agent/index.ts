import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Context, Effect, Layer, Ref, Semaphore, Stream } from "effect";
import { LanguageModel, Response, Tool, Toolkit } from "effect/unstable/ai";
import * as Ctx from "#/context/index.ts";
import { AgentError } from "./error.ts";

type ToolkitServices<Tools extends Record<string, Tool.Any>> = Exclude<
  Tool.HandlerServices<Tools[keyof Tools]> | Tool.ResultDecodingServices<Tools[keyof Tools]>,
  Sandbox.Current
>;

export type Session<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.WithHandler<Tools>;
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPart<Tools>, AgentError>;
}>;

type Agent = Readonly<{
  createSession<Tools extends Record<string, Tool.Any>>(
    toolkit: Toolkit.Toolkit<Tools>,
  ): Effect.Effect<
    Session<Tools>,
    AgentError,
    LanguageModel.LanguageModel | Sandbox.Current | Tool.HandlersFor<Tools> | ToolkitServices<Tools>
  >;
}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {}

const makeSession = <Tools extends Record<string, Tool.Any>>({
  toolkit,
  history,
  ctx,
  sandbox,
  llm,
  services,
}: {
  toolkit: Toolkit.WithHandler<Tools>;
  history: Ref.Ref<Prompt.Prompt>;
  ctx: Ctx.ContextManagement;
  sandbox: Sandbox.Sandbox;
  llm: LanguageModel.Service;
  services: Context.Context<ToolkitServices<Tools>>;
}): Session<Tools> => {
  const semaphore = Semaphore.makeUnsafe(1);

  const prompt = (prompt: Prompt.Prompt): Stream.Stream<Response.StreamPart<Tools>, AgentError> =>
    Effect.gen(function* () {
      yield* semaphore.take(1);

      // Context management: transform (trajectory, prompt) before the round,
      // then replace the trajectory with the transformed one.
      const trajectory = yield* Ref.get(history);
      const pre = yield* ctx.applyPrePrompt({ ...sandbox, trajectory, prompt });
      yield* Ref.set(history, pre.trajectory);

      // The full prompt sent to the model: the transformed trajectory with the
      // transformed prompt appended, mirroring the prompt `Chat.streamText`
      // used to assemble internally before it was bypassed.
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
            yield* Ref.set(history, Prompt.concat(after.trajectory, after.responded));
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
    }).pipe(
      Stream.unwrap,
      Stream.mapError(AgentError.stream),
      Stream.provideService(LanguageModel.LanguageModel, llm),
      Stream.provideService(Sandbox.Current, sandbox),
      Stream.provideContext(services),
    );

  return {
    toolkit,
    trajectory: history,
    prompt,
  } satisfies Session<Tools>;
};

export const layerFrom = (): Layer.Layer<Service, never, Ctx.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ctx = yield* Ctx.Service;
      return {
        createSession: <Tools extends Record<string, Tool.Any>>(toolkit: Toolkit.Toolkit<Tools>) =>
          Effect.gen(function* () {
            const history = yield* Ref.make(Prompt.empty);
            const llm = yield* LanguageModel.LanguageModel;
            const sandbox = yield* Sandbox.Current;
            const withHandler = yield* toolkit;
            const services = yield* Effect.context<ToolkitServices<Tools>>();
            return makeSession({
              toolkit: withHandler,
              history,
              ctx,
              sandbox,
              llm,
              services,
            });
          }),
      } satisfies Agent;
    }),
  );
