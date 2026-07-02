import { Effect } from "effect";
import { ToolLoopAgent, type AgentStreamParameters } from "ai";

export * from "./stream.ts";

export const makeAgent = Effect.fn(function* ({
  agent,
  streamParams,
}: {
  agent: ToolLoopAgent;
  streamParams: AgentStreamParameters<never, {}, Record<string, unknown>>;
}) {});
