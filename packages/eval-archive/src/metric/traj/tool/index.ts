import type { Schema } from "effect";
import { Prompt } from "@open-insight/core/internal";
import type { Response } from "@open-insight/core/internal";
import type { Exec, State } from "../index.ts";

/**
 * A successful tool turn, consisting of a tool call and its corresponding result.
 */
export type ToolTurn = Readonly<{
  call: Response.AnyToolCallPart;
  result: Response.AnyToolResultPart;
}>;

/**
 * Tool turns grouped by tool name.
 */
export type ToolTurnMap = Readonly<Record<string, ReadonlyArray<ToolTurn>>>;

/**
 * Metric state with recorded tool turns.
 */
export type ToolState = State &
  Readonly<{
    toolTurns: ToolTurnMap;
  }>;

export type ToolExec<R extends Schema.Json = any> = (
  state: ToolState,
  turn: ToolTurn,
  prev: R | null,
) => R | null | PromiseLike<R | null>;

export const makeExec = <R extends Schema.Json = any>(exec: ToolExec<R>): Exec<R> => {
  const turns: Record<string, ReadonlyArray<ToolTurn>> = {};
  const pending = new Map<string, Response.AnyToolCallPart>();

  return (state, delta, prev) => {
    if (Prompt.isPrompt(delta)) {
      pending.clear();
      return null;
    }

    if (delta.type === "tool-call") {
      pending.set(delta.id, delta);
      return null;
    }

    if (delta.type !== "tool-result" || delta.preliminary) {
      return null;
    }

    const call = pending.get(delta.id);
    if (call === undefined) {
      return null;
    }

    pending.delete(delta.id);

    const turn: ToolTurn = { call, result: delta };
    turns[call.name] = [...(turns[call.name] ?? []), turn];

    return exec(
      {
        ...state,
        toolTurns: { ...turns },
      },
      turn,
      prev,
    );
  };
};
