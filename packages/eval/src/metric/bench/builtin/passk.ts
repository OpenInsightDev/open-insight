import { calcPassAtK } from "#/metric/task/builtin/passk.ts";
import type { Exec } from "../index.ts";

export const avgPassAtK =
  (k: number): Exec<{ pass: boolean }, number> =>
  (results) => {
    const calc = calcPassAtK(k);
    const values = Object.values(results)
      .map((arr) => arr.map(({ grade }) => grade.pass))
      .map(calc);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
