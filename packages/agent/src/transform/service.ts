import type { Trajectory } from "@open-insight/core";
import { Schema, type Data } from "effect";
import { Response, Prompt, Tool } from "effect/unstable/ai";

export const PromptMessage = Schema.Union([
  Prompt.SystemMessage,
  Prompt.UserMessage,
  Prompt.ToolMessage,
]);
export type PromptMessage = Schema.Schema.Type<typeof PromptMessage>;
export type PromptMessageEncoded = Exclude<Prompt.MessageEncoded, Prompt.AssistantMessageEncoded>;

// "content-filter" | "error" | "length" | "other" | "pause" | "stop" | "tool-calls" | "unknown"
export type Reason = Data.TaggedEnum<{
  ToolCalls: {};
}>;

export type State<Tools extends Record<string, Tool.Any>> = Readonly<{
  trajectory: Trajectory.Trajectory<Tools>;
  prompt: PromptMessage[];
}>;
