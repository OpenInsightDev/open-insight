import * as Prompt from "#/prompt/index.ts";
import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import { Context, Effect, Layer, Option, Ref, Schema, Scope, Semaphore, Stream } from "effect";
import { AgentError } from "./error.ts";
import { Response, Toolkit } from "effect/unstable/ai";

export type Agent = Readonly<{
  /**
   * Ref of an append- and read-only view of the prompt trajectory, including
   * all prompts and responses that have been streamed so far.
   *
   * Note that this trajectory may not equate to the internal state of the agent.
   */
  trajectory: Ref.Ref<Prompt.Prompt>;

  /**
   * Sends a prompt to the agent and returns a stream of response parts.
   */
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartView<{}>, AgentError>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(sandbox: Sandbox.Sandbox): Effect.Effect<Agent, AgentError, Scope.Scope>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}

type AgentOptions = Readonly<{
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartEncoded, AgentError>;
}>;
type ProviderOptions = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(sandbox: Sandbox.Sandbox): Effect.Effect<AgentOptions, AgentError, Scope.Scope>;
}>;

const makeAgent = Effect.fn("Agent.makeAgent")(function* ({
  prompt: promptFn,
}: AgentOptions): Effect.fn.Return<Agent, AgentError> {
  const trajectory = yield* Ref.make<Prompt.Prompt>(Prompt.empty);
  const promptSem = Semaphore.makeUnsafe(1);
  const decodePart = Schema.decodeEffect(Response.StreamPart(Toolkit.empty));

  const prompt = Effect.fn(function* (prompt: Prompt.Prompt) {
    yield* promptSem.take(1);

    const current = yield* Ref.get(trajectory);
    const nextTrajectory = Prompt.concat(current, prompt);

    const parts: Array<Response.AnyPart> = [];
    const encoded = promptFn(nextTrajectory).pipe(Stream.mapError(AgentError.stream));

    return encoded.pipe(
      Stream.mapEffect((part) => decodePart(part).pipe(Effect.mapError(AgentError.stream))),
      Stream.tap(
        Effect.fn(function* (part) {
          parts.push(part);
        }),
      ),
      Stream.ensuring(
        Ref.set(trajectory, Prompt.concat(nextTrajectory, Prompt.fromResponseParts(parts))).pipe(
          Effect.andThen(promptSem.release(1)),
        ),
      ),
    );
  }, Stream.unwrap);

  return { trajectory, prompt } satisfies Agent;
});

export const make = (options: ProviderOptions) => {
  return {
    snapshotExtension: options.snapshotExtension,
    runSession: Effect.fn(function* (sandbox) {
      const agentOptions = yield* options.runSession(sandbox);
      return yield* makeAgent(agentOptions);
    }),
  } satisfies Provider;
};

export const layerFrom = (options: ProviderOptions): Layer.Layer<ProviderService> =>
  Layer.succeed(ProviderService, make(options));
