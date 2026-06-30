import * as Sandbox from "@/sandbox/index.ts";
import { Context, Effect, Stream } from "effect";
import { Prompt, Response } from "effect/unstable/ai";
import { type AgentError } from "./error.ts";
import type { Prompt as Trajectory } from "effect/unstable/ai/Prompt";

export type Agent = Readonly<{
  trajectory(): Effect.Effect<Trajectory, AgentError>;
  prompt(options: {
    prompt: ReadonlyArray<Prompt.UserMessage>;
  }): Effect.Effect<Stream.Stream<Response.StreamPart<any>, AgentError>>;
}>;

export type Provider = Readonly<{
  deriveSnapshot: (
    options: Readonly<{ snapshot: Sandbox.Snapshot.Snapshot; context: Sandbox.Context.Mode }>,
  ) => Effect.Effect<Sandbox.Snapshot.Snapshot, AgentError>;

  runSession(options: Readonly<{ sandbox: Sandbox.Sandbox }>): Effect.Effect<Agent, AgentError>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}
