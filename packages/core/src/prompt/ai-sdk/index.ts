import { Effect } from "effect";
import {
  ToolLoopAgent,
  type AgentStreamParameters,
  type StreamTextResult,
  type ToolSet,
  Output,
  type ModelMessage,
} from "ai";

export * from "./stream.ts";

export interface Streamable {
  stream(
    prompt: Array<ModelMessage>,
  ): Promise<StreamTextResult<ToolSet, Record<string, unknown>, Output.Output>>;
}

export const fromToolLoopAgent = Effect.fn(function* ({
  agent,
  streamParams,
}: {
  agent: ToolLoopAgent;
  streamParams: AgentStreamParameters<never, {}, Record<string, unknown>>;
}) {});

export const fromStreamable = Effect.fn(function* ({ streamable }: { streamable: Streamable }) {});
