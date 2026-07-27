import * as Sandbox from "#/sandbox/index.ts";
import * as Snapshot from "#/snapshot/index.ts";
import type * as Prompt from "#/prompt/index.ts";
import { Context, Effect, Option, Stream } from "effect";
import { Response, Tool } from "effect/unstable/ai";
import type { Error } from "./error.ts";

export type Toolset = Record<string, Tool.Any>;

export type StreamPart<Tools extends Toolset = Toolset> = Response.StreamPart<Tools>;

export type Agent<Tools extends Toolset = Toolset> = Readonly<{
  trajectory(): Effect.Effect<Prompt.Trajectory, Error>;
  prompt(trajectory: Prompt.Trajectory): Stream.Stream<StreamPart<Tools>, Error>;
}>;

export type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;

export type Provider<Tools extends Toolset = Toolset> = Readonly<{
  snapshotExtension: Option.Option<SnapshotExtension>;
  runSession(sandbox: Sandbox.Sandbox): Effect.Effect<Agent<Tools>, Error>;
}>;

export class ProviderService extends Context.Service<ProviderService, Provider>()(
  "agent/AgentService",
) {}
