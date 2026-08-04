import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Scope, Stream } from "effect";
import type { AgentError } from "./error.ts";
import type { StreamPartEncoded } from "effect/unstable/ai/Response";

export type Agent = Readonly<{
  trajectory: Effect.Effect<Prompt.Trajectory, AgentError>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<StreamPartEncoded, AgentError>;
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
