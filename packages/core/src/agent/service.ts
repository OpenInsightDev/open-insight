import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Ref, Scope, Stream } from "effect";
import type { AgentError } from "./error.ts";
import { Response } from "effect/unstable/ai";

export type Agent = Readonly<{
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

type PromptFn = (prompt: Prompt.Prompt) => Stream.Stream<Response.StreamPartEncoded, AgentError>;

export const layerFrom = Effect.fn(function* (
  prompt: PromptFn,
): Effect.fn.Return<Agent, AgentError> {
  throw new Error("Not implemented");
});

type PromptAsyncFn = (prompt: Prompt.Prompt) => AsyncIterable<Response.StreamPartEncoded>;

export const layerFromAsync = Effect.fn(function* (
  prompt: PromptAsyncFn,
): Effect.fn.Return<Agent, AgentError> {
  throw new Error("Not implemented");
});
