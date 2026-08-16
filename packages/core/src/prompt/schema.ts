import type { AssistantMessagePart, ToolMessagePart } from "effect/unstable/ai/Prompt";

/**
 * Prompt message part that can occur in the agent's response.
 */
export type ResponseMessagePart = AssistantMessagePart | ToolMessagePart;
