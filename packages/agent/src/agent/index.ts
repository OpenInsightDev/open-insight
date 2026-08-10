import { Prompt, Sandbox } from "@open-insight/core/internal";
import { Context, Effect, Layer, Ref, Semaphore, Stream } from "effect";
import { LanguageModel, Response, Tool, Toolkit } from "effect/unstable/ai";
import * as Ctx from "#/context/index.ts";
import { AgentError } from "./error.ts";

/**
 * A stateful agent session with context management middlewares applied around
 * every round.
 *
 * **Details**
 *
 * The session owns a single history `Ref` that doubles as the session
 * trajectory. Every `prompt` round runs the context management pipeline:
 *
 * 1. `PrePrompt` middlewares transform `{ sandbox, trajectory, prompt }`. The
 *    returned trajectory replaces the current one, and the returned prompt is
 *    sent to the language model (concatenated onto the trajectory).
 * 2. The response streams back and every emitted part is collected.
 * 3. Once the stream ends, `AfterRespond` middlewares transform
 *    `{ sandbox, trajectory, responded }`. The returned trajectory replaces
 *    the current one and the returned `responded` is appended to its end.
 *
 * History is managed by the session itself: the round drives
 * `LanguageModel.streamText` directly (mirroring what `Chat.streamText` did,
 * minus the automatic history commit) and the `{ trajectory, responded }`
 * tuple returned by `AfterRespond` is the **only** value ever written to the
 * history `Ref`. `AfterRespond` therefore always runs before `responded` is
 * appended to the trajectory, and no raw intermediate state is observable.
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
  history: Ref.Ref<Prompt.Prompt>,
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
      const trajectory = yield* Ref.get(history);
      const pre = yield* ctx.applyPrePrompt({ ...sandbox, trajectory, prompt });
      yield* Ref.set(history, pre.trajectory);

      // Resolve the toolkit handlers from the surrounding context.
      const withHandler = yield* toolkit;

      // The full prompt sent to the model: the transformed trajectory with the
      // transformed prompt appended, mirroring the prompt `Chat.streamText`
      // used to assemble internally before it was bypassed.
      const fullPrompt = Prompt.concat(pre.trajectory, pre.prompt);

      const parts: Array<Response.AnyPart> = [];

      return LanguageModel.streamText({ prompt: fullPrompt, toolkit: withHandler }).pipe(
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
            // Single commit: the transformed tuple is the only value written
            // to history this round, so `AfterRespond` strictly precedes the
            // append of `responded` to the trajectory.
            yield* Ref.set(history, Prompt.concat(after.trajectory, after.responded));
          }).pipe(
            // Guarantee the session semaphore is released even if a middleware
            // defects, preserving `Chat`'s commit-then-release ordering.
            Effect.ensuring(semaphore.release(1)),
          ),
        ),
        Stream.withSpan("Agent.prompt", { captureStackTrace: false }),
      );
    }).pipe(Stream.unwrap, Stream.mapError(AgentError.stream));

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
        createSession: (toolkit) =>
          Effect.gen(function* () {
            const history = yield* Ref.make(Prompt.empty);
            return makeSession(toolkit, history, ctx);
          }),
      } satisfies Agent;
    }),
  );
