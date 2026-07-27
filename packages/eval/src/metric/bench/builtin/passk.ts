import {
  countCorrectBy,
  estimatePassAtK,
  estimatePassPowK,
  type BooleanField,
  type Pass,
} from "#/metric/common/passk.ts";
import type * as Grade from "#/grade/index.ts";
import type { Exec, Results } from "../index.ts";

export type AvgPassAtK = Readonly<{ "pass@k": number }>;
export type AvgPassPowK = Readonly<{ "pass^k": number }>;
type Estimate = (total: number, correct: number, k: number) => number;

const mean = (values: ReadonlyArray<number>) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const averageEstimate = (results: Results, field: string, k: number, estimate: Estimate) =>
  mean(
    Object.values(results).map((trails) =>
      estimate(
        trails.length,
        countCorrectBy(trails, (grade: Grade.Result) => grade[field] === true),
        k,
      ),
    ),
  );

export function avgPassAtK<G extends Pass>(k: number): Exec<G, AvgPassAtK>;
export function avgPassAtK<const Key extends string>(
  k: number,
  field: Key,
): Exec<BooleanField<Key>, AvgPassAtK>;
export function avgPassAtK(k: number, field = "pass") {
  return async (results: Results): Promise<AvgPassAtK> => ({
    "pass@k": averageEstimate(results, field, k, estimatePassAtK),
  });
}

export function avgPassPowK<G extends Pass>(k: number): Exec<G, AvgPassPowK>;
export function avgPassPowK<const Key extends string>(
  k: number,
  field: Key,
): Exec<BooleanField<Key>, AvgPassPowK>;
export function avgPassPowK(k: number, field = "pass") {
  return async (results: Results): Promise<AvgPassPowK> => ({
    "pass^k": averageEstimate(results, field, k, estimatePassPowK),
  });
}
