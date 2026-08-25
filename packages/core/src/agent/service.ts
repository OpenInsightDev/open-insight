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
   * Note that this trajectory does not equate to the internal state of the agent.
   */
  trajectory: Ref.Ref<Prompt.Trajectory>;

  /**
   * Sends a prompt to the agent and returns a stream of response parts.
   */
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.StreamPartEncoded, AgentError>;
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
  const trajectory = yield* Ref.make<Prompt.Trajectory>(Prompt.empty);
  const semaphore = Semaphore.makeUnsafe(1);
  const decodePart = Schema.decodeEffect(Response.StreamPart(Toolkit.empty));

  const prompt = (prompt: Prompt.Prompt) =>
    Effect.gen(function* () {
      yield* semaphore.take(1);
      const current = yield* Ref.get(trajectory);
      const nextTrajectory = Prompt.concat(current, prompt);

      const parts: Array<Response.AnyPart> = [];
      const encoded = promptFn(nextTrajectory).pipe(Stream.mapError(AgentError.stream));

      return encoded.pipe(
        Stream.tap((part) =>
          decodePart(part).pipe(
            Effect.tap((decoded) => Effect.sync(() => parts.push(decoded))),
            Effect.mapError(AgentError.stream),
          ),
        ),
        Stream.ensuring(
          Effect.andThen(
            Ref.set(trajectory, Prompt.concat(nextTrajectory, Prompt.fromResponseParts(parts))),
            semaphore.release(1),
          ),
        ),
      );
    }).pipe(Stream.unwrap);

  return { trajectory, prompt } satisfies Agent;
});

export const make = (options: ProviderOptions): Effect.Effect<Provider> => {
  const { snapshotExtension, runSession: runSessionFn } = options;
  const runSession = Effect.fn("Agent.runSession")(function* (sandbox: Sandbox.Sandbox) {
    const agentOptions = yield* runSessionFn(sandbox);
    return yield* makeAgent(agentOptions);
  });

  return Effect.succeed({ snapshotExtension, runSession } satisfies Provider);
};

export const layerFrom = (options: ProviderOptions): Layer.Layer<ProviderService> =>
  Layer.effect(ProviderService, make(options));
