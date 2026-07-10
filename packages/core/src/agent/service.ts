import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as PromptModel from "#/prompt/index.ts";
import { Context, Effect, Option, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import { type AgentError } from "./error.ts";

export type StreamPart = Response.StreamPart<never>;

export type Agent = Readonly<{
  trajectory(): Effect.Effect<PromptModel.Trajectory, AgentError>;
  prompt(options: {
    prompt: ReadonlyArray<PromptModel.UserMessage>;
  }): Stream.Stream<StreamPart, AgentError>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(options: Readonly<{ sandbox: Sandbox.Sandbox }>): Effect.Effect<Agent, AgentError>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}
