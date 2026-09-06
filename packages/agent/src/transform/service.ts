import type { Data } from "effect";
import { Response } from "effect/unstable/ai";

// "content-filter" | "error" | "length" | "other" | "pause" | "stop" | "tool-calls" | "unknown"
export type Reason = Data.TaggedEnum<{
  ToolCalls: {};
}>;
