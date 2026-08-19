import type { ToolTurn, ToolTurnMap } from "./index.ts";

export const failCount = (turns: ReadonlyArray<ToolTurn>): number =>
  turns.filter((turn) => turn.result.isFailure).length;

export const successCount = (turns: ReadonlyArray<ToolTurn>): number =>
  turns.filter((turn) => !turn.result.isFailure).length;

export const failRate = (turns: ReadonlyArray<ToolTurn>): number => {
  const total = turns.length;
  if (total === 0) return 0;
  return failCount(turns) / total;
};

export const successRate = (turns: ReadonlyArray<ToolTurn>): number => {
  const total = turns.length;
  if (total === 0) return 0;
  return successCount(turns) / total;
};

export const count = (turns: ToolTurnMap): number =>
  Object.values(turns).reduce((acc, toolTurns) => acc + toolTurns.length, 0);

export const rateOf =
  (turns: ToolTurnMap) =>
  (id: string): number => {
    const toolTurns = turns[id] ?? [];
    const total = toolTurns.length;
    if (total === 0) return 0;
    return successCount(toolTurns) / total;
  };
