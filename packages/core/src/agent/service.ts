import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Stream } from "effect";
import type { Error } from "./error.ts";
import type { AnyPart } from "effect/unstable/ai/Response";

export type StreamPart = AnyPart;

export type Agent = Readonly<{
  trajectory(): Effect.Effect<Prompt.Trajectory, Error>;
  prompt(prompt: Prompt.Prompt): Stream.Stream<StreamPart, Error>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type Provider = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(sandbox: Sandbox.Sandbox): Effect.Effect<Agent, Error>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}
