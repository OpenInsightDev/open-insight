import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Layer, Option, Ref, Scope, Semaphore, Stream } from "effect";
import { AgentError } from "./error.ts";
import { Response } from "effect/unstable/ai";

export type Agent = Readonly<{
  /**
   * Current trajectory of the agent.
   */
  trajectory: Ref.Ref<Prompt.Trajectory>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Prompt.AnyStreamPart, AgentError>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type SessionOptions = Readonly<{}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(
    sandbox: Sandbox.Sandbox,
    options?: SessionOptions,
  ): Effect.Effect<Agent, AgentError, Scope.Scope>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}

export type PromptFn = (prompt: Prompt.Prompt) => Stream.Stream<Response.StreamPartEncoded, AgentError>;

type PromptAsyncFn = (prompt: Prompt.Prompt) => AsyncIterable<Response.StreamPartEncoded>;

/**
 * Builds an `Agent` from a model function that produces encoded response parts.
 *
 * The trajectory is accumulated manually: the caller's prompt is concatenated
 * onto the current history before it is handed to the model, and as encoded
 * parts stream back they are decoded and collected. Once the response stream
 * terminates, the trajectory is committed back into the history `Ref`.
 *
 * Concurrent `prompt` calls on the same agent are serialized with a binary
 * semaphore (mirroring `effect/unstable/ai/Chat`): a single mutex guards the
 * whole streaming lifecycle, so history is read and committed atomically and
 * never races. Concurrent calls queue up and run one at a time, each
 * accumulating its own prompt + response into the history in lock-grant order.
 */
const makeAgent = Effect.fn(function* (
  run: PromptFn,
): Effect.fn.Return<Agent, AgentError> {
  const history = yield* Ref.make<Prompt.Prompt>(Prompt.empty);
  const semaphore = Semaphore.makeUnsafe(1);

  const promptStream = (prompt: Prompt.Prompt): Stream.Stream<Prompt.AnyStreamPart, AgentError> =>
    Effect.gen(function* () {
      const current = yield* semaphore.take(1).pipe(Effect.flatMap(() => Ref.get(history)));
      const trajectory = Prompt.concat(current, prompt);

      const parts: Array<Response.AnyPart> = [];

      return run(trajectory).pipe(
        Prompt.decodeResponseStream,
        Stream.mapError(AgentError.stream),
        Stream.tap((part) =>
          Effect.sync(() => {
            parts.push(part);
          }),
        ),
        Stream.ensuring(
          Effect.andThen(
            Ref.update(history, (_) => Prompt.concat(trajectory, Prompt.fromResponseParts(parts))),
            semaphore.release(1),
          ),
        ),
      );
    }).pipe(Stream.unwrap);

  return {
    trajectory: history,
    prompt: promptStream,
  } satisfies Agent;
});

/**
 * Creates an `Agent` from a model function that streams encoded response
 * parts, given a `Prompt`. See {@link makeAgent} for the accumulation details.
 */
export const make = Effect.fn(function* (prompt: PromptFn): Effect.fn.Return<Agent, AgentError> {
  return yield* makeAgent(prompt);
});

/**
 * Creates an `Agent` from a model function that yields encoded response parts
 * as an `AsyncIterable`, given a `Prompt`.
 */
export const makeAsync = Effect.fn(function* (
  prompt: PromptAsyncFn,
): Effect.fn.Return<Agent, AgentError> {
  return yield* makeAgent((trajectory) =>
    Stream.fromAsyncIterable(prompt(trajectory), AgentError.stream),
  );
});

/**
 * Creates a `Provider` layer from a model function that streams encoded
 * response parts. Each `runSession` yields a fresh {@link make} `Agent` with
 * its own trajectory. The provider carries the given `snapshotExtension` (if
 * provided) so a harness can derive the sandbox snapshot before running.
 */
export const layerFrom = (
  prompt: PromptFn,
  snapshotExtension?: SnapshotExtension,
): Layer.Layer<ProviderService, AgentError> =>
  Layer.effect(
    ProviderService,
    Effect.succeed({
      snapshotExtension: Option.fromNullishOr(snapshotExtension),
      runSession: () => make(prompt),
    } satisfies Provider),
  );

/**
 * Creates a `Provider` layer from a model function that yields encoded
 * response parts as an `AsyncIterable`. Each `runSession` yields a fresh
 * {@link makeAsync} `Agent` with its own trajectory. The provider carries the
 * given `snapshotExtension` (if provided) so a harness can derive the sandbox
 * snapshot before running.
 */
export const layerFromAsync = (
  prompt: PromptAsyncFn,
  snapshotExtension?: SnapshotExtension,
): Layer.Layer<ProviderService, AgentError> =>
  Layer.effect(
    ProviderService,
    Effect.succeed({
      snapshotExtension: Option.fromNullishOr(snapshotExtension),
      runSession: () => makeAsync(prompt),
    } satisfies Provider),
  );
