import { calcPassAtK } from "#/metric/task/builtin/passk.ts";
import type { BenchResult } from "../index.ts";

export type PassGrade = { pass: boolean };

export const calcAvgPassAtK =
  (k: number) =>
  (results: BenchResult<PassGrade>): number => {
    const calc = calcPassAtK(k);
    const values = Object.values(results)
      .map((arr) => arr.map(({ grade }) => grade.pass))
      .map(calc);

    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

export const avgPassAtK = calcAvgPassAtK;
