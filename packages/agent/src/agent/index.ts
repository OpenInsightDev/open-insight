import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Context, Effect, Layer, Ref, Semaphore, Stream } from "effect";
import { Chat, Response, Tool, Toolkit, type LanguageModel } from "effect/unstable/ai";
import * as Ctx from "#/context/index.ts";
import { AgentError } from "./error.ts";

/**
 * A stateful agent session backed by `Chat`, with context management
 * middlewares applied around every round.
 *
 * **Details**
 *
 * The session owns a single `Chat` instance whose history `Ref` doubles as the
 * session trajectory. Every `prompt` round runs the context management
 * pipeline:
 *
 * 1. `PrePrompt` middlewares transform `{ sandbox, trajectory, prompt }`. The
 *    returned trajectory replaces the current one, and the returned prompt is
 *    sent to the language model (concatenated onto the trajectory).
 * 2. The response streams back and every emitted part is collected.
 * 3. Once the stream ends, `AfterRespond` middlewares transform
 *    `{ sandbox, trajectory, responded }`. The returned trajectory replaces
 *    the current one and the returned `responded` is appended to its end.
 *
 * Concurrent `prompt` calls on the same session are serialized with a binary
 * semaphore so history is read, transformed and committed atomically. The
 * toolkit handlers are resolved from the surrounding context on each round
 * (via `yield* toolkit`).
 */
export type Session<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(
    prompt: Prompt.Prompt,
  ): Stream.Stream<
    Response.StreamPart<Tools>,
    AgentError,
    | LanguageModel.LanguageModel
    | Sandbox.Current
    | Tool.HandlersFor<Tools>
    | Tool.HandlerServices<Tools[keyof Tools]>
    | Tool.ResultDecodingServices<Tools[keyof Tools]>
  >;
}>;

type Agent = Readonly<{
  createSession<Tools extends Record<string, Tool.Any>>(
    toolkit: Toolkit.Toolkit<Tools>,
  ): Effect.Effect<Session<Tools>>;
}>;

export class Service extends Context.Service<Service, Agent>()("open-insight/Agent") {}

const makeSession = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  chat: Chat.Service,
  ctx: Ctx.ContextManagement,
): Session<Tools> => {
  const semaphore = Semaphore.makeUnsafe(1);

  const prompt = (
    prompt: Prompt.Prompt,
  ): Stream.Stream<
    Response.StreamPart<Tools>,
    AgentError,
    | LanguageModel.LanguageModel
    | Sandbox.Current
    | Tool.HandlersFor<Tools>
    | Tool.HandlerServices<Tools[keyof Tools]>
    | Tool.ResultDecodingServices<Tools[keyof Tools]>
  > =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Current;
      yield* semaphore.take(1);

      // Context management: transform (trajectory, prompt) before the round,
      // then replace the trajectory with the transformed one.
      const trajectory = yield* Ref.get(chat.history);
      const pre = yield* ctx.applyPrePrompt({ ...sandbox, trajectory, prompt });
      yield* Ref.set(chat.history, pre.trajectory);

      // Resolve the toolkit handlers from the surrounding context.
      const withHandler = yield* toolkit;

      const parts: Array<Response.AnyPart> = [];

      return chat.streamText({ prompt: pre.prompt, toolkit: withHandler }).pipe(
        Stream.tap((part) =>
          Effect.sync(() => {
            parts.push(part);
          }),
        ),
        // Context management: once the response ends, transform
        // (trajectory + prompt, responded) and append responded to the end of
        // the (possibly replaced) trajectory. Runs on success, failure and
        // interruption, mirroring `Chat`'s own history commit.
        Stream.ensuring(
          Effect.gen(function* () {
            const after = yield* ctx.applyAfterRespond({
              ...sandbox,
              trajectory: Prompt.concat(pre.trajectory, pre.prompt),
              responded: Prompt.fromResponseParts(parts),
            });
            yield* Ref.set(chat.history, Prompt.concat(after.trajectory, after.responded));
            yield* semaphore.release(1);
          }),
        ),
      );
    }).pipe(Stream.unwrap, Stream.mapError(AgentError.stream));

  return {
    toolkit,
    trajectory: chat.history,
    prompt,
  } satisfies Session<Tools>;
};

export const layerFrom = (): Layer.Layer<Service, never, Ctx.Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ctx = yield* Ctx.Service;
      return {
        createSession: (toolkit) =>
          Effect.gen(function* () {
            const chat = yield* Chat.empty;
            return makeSession(toolkit, chat, ctx);
          }),
      } satisfies Agent;
    }),
  );
