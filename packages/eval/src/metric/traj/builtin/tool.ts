import type { Prompt } from "@open-insight/core/internal";

type PartType = Prompt.Part["type"];
type ToolCallPart = Extract<Prompt.Part, { type: "tool-call" }>;
type ToolResultPart = Extract<Prompt.Part, { type: "tool-result" }>;
type Context = Readonly<{ parts: Prompt.Parts; prevTrajectory: Prompt.Trajectory }>;

export type Count = Readonly<{ count: number }>;
export type Rate = Readonly<{ rate: number }>;

const previousParts = (trajectory: Prompt.Trajectory): Prompt.Parts => {
  const parts: Array<Prompt.Part> = [];

  for (const message of trajectory.content) {
    if (typeof message.content !== "string") {
      for (const part of message.content) {
        parts.push(part);
      }
    }
  }

  return parts;
};

const allParts = ({ parts, prevTrajectory }: Context): Prompt.Parts => [
  ...previousParts(prevTrajectory),
  ...parts,
];

const isToolCall = (part: Prompt.Part): part is ToolCallPart => part.type === "tool-call";
const isToolResult = (part: Prompt.Part): part is ToolResultPart => part.type === "tool-result";
const hasName = (name: string | undefined) => (part: ToolCallPart | ToolResultPart) =>
  name === undefined || part.name === name;

/** Counts trajectory parts observed so far, optionally filtered by part type. */
export const partCount =
  (type?: PartType) =>
  async (context: Context): Promise<Count> => ({
    count: allParts(context).filter((part) => type === undefined || part.type === type).length,
  });

/** Counts tool calls observed so far, optionally filtered by tool name. */
export const toolCallCount =
  (name?: string) =>
  async (context: Context): Promise<Count> => ({
    count: allParts(context).filter(isToolCall).filter(hasName(name)).length,
  });

/**
 * Returns the success rate of completed tool calls observed so far.
 *
 * Calls without a result are excluded. The rate is zero when no matching call has
 * completed yet.
 */
export const toolCallSuccessRate =
  (name?: string) =>
  async (context: Context): Promise<Rate> => {
    const results = allParts(context).filter(isToolResult).filter(hasName(name));
    const successes = results.filter((result) => !result.isFailure).length;

    return { rate: results.length === 0 ? 0 : successes / results.length };
  };
