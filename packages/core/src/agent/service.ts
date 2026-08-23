import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Ref, Scope, Schema, Semaphore, Stream } from "effect";
import { AgentError } from "./error.ts";
import { Response, Tool, Toolkit } from "effect/unstable/ai";

export type Agent<Tools extends Record<string, Tool.Any>> = Readonly<{
  toolkit: Toolkit.Toolkit<Tools>;
  /**
   * Ref of a append- and read-only view of the prompt trajectory, including all prompts and responses that have been streamed so far.
   *
   * Note that this trajectory does not equate to the internal state of the agent.
   */
  trajectory: Ref.Ref<Prompt.Trajectory>;

  prompt(
    prompt: Prompt.Prompt,
  ): Stream.Stream<
    Response.StreamPart<Tools>,
    AgentError,
    Tool.ResultDecodingServices<Tools[keyof Tools]>
  >;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;

  runSession<Tools extends Record<string, Tool.Any> = {}>(
    sandbox: Sandbox.Sandbox,
    toolkit?: Toolkit.Toolkit<Tools>,
  ): Effect.Effect<Agent<Tools>, AgentError, Scope.Scope>;
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

const makeAgent = Effect.fn(function* <Tools extends Record<string, Tool.Any>>(
  { prompt: promptFn }: AgentOptions,
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.fn.Return<Agent<Tools>, AgentError> {
  const trajectory = yield* Ref.make<Prompt.Trajectory>(Prompt.empty);
  const semaphore = Semaphore.makeUnsafe(1);

  const decodePart = Schema.decodeEffect(Response.StreamPart(toolkit));

  const promptStream = (prompt: Prompt.Prompt) =>
    Effect.gen(function* () {
      yield* semaphore.take(1);
      const current = yield* Ref.get(trajectory);
      const nextTrajectory = Prompt.concat(current, prompt);
      const parts: Array<Response.AnyPart> = [];

      const decoded = promptFn(nextTrajectory).pipe(
        Stream.mapEffect((part) => decodePart(part)),
        Stream.mapError(AgentError.stream),
      );

      return decoded.pipe(
        Stream.tap((part) => Effect.sync(() => parts.push(part))),
        Stream.ensuring(
          Effect.andThen(
            Ref.set(trajectory, Prompt.concat(nextTrajectory, Prompt.fromResponseParts(parts))),
            semaphore.release(1),
          ),
        ),
      );
    }).pipe(Stream.unwrap);

  return {
    toolkit,
    trajectory,
    prompt: promptStream,
  } satisfies Agent<Tools>;
});

// export const make = (options: ProviderOptions): Effect.Effect<Provider> => {
//   const { snapshotExtension, runSession: runSessionFn } = options;
//   const runSession = function <Tools extends Record<string, Tool.Any> = {}>(
//     sandbox: Sandbox.Sandbox,
//     toolkit?: Toolkit.Toolkit<Tools>,
//   ): Effect.Effect<Agent<Tools>, AgentError, Scope.Scope> {
//     return Effect.gen(function* () {
//       const agentOptions = yield* runSessionFn(sandbox);
//       return yield* makeAgent(agentOptions, toolkit);
//     });
//   };

//   return Effect.succeed({
//     snapshotExtension,
//     runSession,
//   } satisfies Provider);
// };

// export const layerFrom = (options: ProviderOptions): Layer.Layer<ProviderService> =>
//   Layer.effect(ProviderService, make(options));
