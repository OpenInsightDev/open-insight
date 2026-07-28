import {
  countCorrect,
  estimatePassAtK,
  estimatePassPowK,
  type Pass,
} from "#/metric/common/passk.ts";
import { exec, type ExecEffect, type Results } from "../index.ts";

export type AvgPassAtK = Readonly<{ "pass@k": number }>;
export type AvgPassPowK = Readonly<{ "pass^k": number }>;
type Estimate = (total: number, correct: number, k: number) => number;

const mean = (values: ReadonlyArray<number>) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const averageEstimate = (results: Results<Pass>, k: number, estimate: Estimate) =>
  mean(Object.values(results).map((trails) => estimate(trails.length, countCorrect(trails), k)));

export const avgPassAtK = <G extends Pass>(k: number): ExecEffect<G, AvgPassAtK> =>
  exec<G, AvgPassAtK>(async (results) => ({
    "pass@k": averageEstimate(results, k, estimatePassAtK),
  }));

export const avgPassPowK = <G extends Pass>(k: number): ExecEffect<G, AvgPassPowK> =>
  exec<G, AvgPassPowK>(async (results) => ({
    "pass^k": averageEstimate(results, k, estimatePassPowK),
  }));
