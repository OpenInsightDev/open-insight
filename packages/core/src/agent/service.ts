import * as Sandbox from "@/sandbox/index.ts";
import { Context, Effect, Option, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import { type AgentError } from "./error.ts";
import type { Prompt as Trajectory } from "effect/unstable/ai/Prompt";
import { Snapshot } from "@/sandbox/index.ts";

export type Agent = Readonly<{
  trajectory(): Effect.Effect<Trajectory, AgentError>;
  prompt(options: {
    prompt: ReadonlyArray<Prompt.UserMessage>;
  }): Effect.Effect<Stream.Stream<Response.StreamPart<any>, AgentError>>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context: Sandbox.Context.Context;
}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(options: Readonly<{ sandbox: Sandbox.Sandbox }>): Effect.Effect<Agent, AgentError>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}
