import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Scope, Stream } from "effect";
import type { AgentError } from "./error.ts";
import { Response } from "effect/unstable/ai";

export type Agent = Readonly<{
  trajectory: Effect.Effect<Prompt.Trajectory, AgentError>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<Response.PartEncoded, AgentError>;
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

export const layerFrom = Effect.fn(function* (
  prompt: (prompt: Prompt.Prompt) => Effect.Effect<Agent, AgentError>,
): Effect.fn.Return<Agent, AgentError> {
  throw new Error("Not implemented");
});

export const layerFromAsync = Effect.fn(function* (
  prompt: (prompt: Prompt.Prompt) => AsyncIterable<Response.StreamPartEncoded>,
): Effect.fn.Return<Agent, AgentError> {
  throw new Error("Not implemented");
});
