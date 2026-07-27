import type { Trajectory } from "./index.ts";

/**
 * Returns the first user request content from the given trajectory.
 * Returns null if the first message is not exactly a user message.
 */
export const request = (traj: Trajectory): string | null => {
  const content = traj.content;

  if (content.length === 0) {
    return null;
  }

  const first = content[0];
  if (first.role === "user" && typeof first === "string") {
    return first;
  }

  return null;
};

/**
 * Returns the last assistant response content from the given trajectory.
 * Returns null if the last message is not exactly an assistant message.
 */
export const response = (traj: Trajectory): string | null => {
  const content = traj.content;

  if (content.length === 0) {
    return null;
  }

  const last = content[content.length - 1];
  if (last.role === "assistant" && typeof last === "string") {
    return last;
  }

  return null;
};

export const length = (traj: Trajectory): number => traj.content.length;

export const toolCalls = (traj: Trajectory): number =>
  traj.content.filter((msg) => msg.role === "tool").length;
