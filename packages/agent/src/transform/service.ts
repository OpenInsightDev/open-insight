import type { Trajectory } from "@open-insight/core";
import type { Data } from "effect";
import { Response, Prompt, Tool } from "effect/unstable/ai";

// "content-filter" | "error" | "length" | "other" | "pause" | "stop" | "tool-calls" | "unknown"
export type Reason = Data.TaggedEnum<{
  ToolCalls: {};
}>;

export type State<Tools extends Record<string, Tool.Any>> = Readonly<{
  trajectory: Trajectory.Trajectory<Tools>;
}>;
