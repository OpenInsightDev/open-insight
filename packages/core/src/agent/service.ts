import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import * as Prompt from "#/prompt/index.ts";
import * as Response from "#/response/index.ts";
import { Context, Effect, Layer, Option, Ref, Scope, Semaphore, Stream } from "effect";
import { AgentError } from "./error.ts";

export type Agent = Readonly<{
  /**
   * Ref of a append- and read-only view of the prompt trajectory, including all prompts and responses that have been streamed so far.
   *
   * Note that this trajectory does not equate to the internal state of the agent.
   */
  trajectory: Ref.Ref<Prompt.Trajectory>;

  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.AnyStreamPart, AgentError>;
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

const makeAgent = Effect.fn(function* ({ prompt: promptFn }: AgentOptions) {
  const trajectory = yield* Ref.make<Prompt.Trajectory>(Prompt.empty);
  const sem = Semaphore.makeUnsafe(1);

  const promptStream = (prompt: Prompt.Prompt): Stream.Stream<Response.AnyStreamPart, AgentError> =>
    Effect.gen(function* () {
      yield* Ref.get(trajectory).pipe(sem.withPermit);
      const parts: Array<Response.AnyStreamPart> = [];

      const decoded = promptFn(prompt).pipe(
        Response.decodeStream,
        Stream.mapError(AgentError.stream),
      );

      return decoded.pipe(
        Stream.tap((part) => Effect.sync(() => parts.push(part))),
        Stream.ensuring(
          Effect.andThen(
            Ref.update(trajectory, (history) =>
              history.pipe(Prompt.concat(prompt), Prompt.concat(Prompt.fromResponseParts(parts))),
            ),
            sem.release(1),
          ),
        ),
      );
    }).pipe(Stream.unwrap);

  return {
    trajectory,
    prompt: promptStream,
  } satisfies Agent;
});

export const make = Effect.fn(function* ({
  snapshotExtension,
  runSession: runSessionFn,
}: ProviderOptions) {
  const runSession = Effect.fn(function* (sandbox: Sandbox.Sandbox) {
    const agentOptions = yield* runSessionFn(sandbox);
    return yield* makeAgent(agentOptions);
  }) satisfies Provider["runSession"];

  return {
    snapshotExtension,
    runSession,
  } satisfies Provider;
});

export const layerFrom = (options: ProviderOptions): Layer.Layer<ProviderService> =>
  Layer.effect(ProviderService, make(options));
