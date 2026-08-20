import type { Collect } from "../index.ts";

export const calcPassAtK =
  (k: number) =>
  (passes: boolean[]): number => {
    const n = passes.length;
    const c = passes.filter((pass) => pass).length;

    if (n === 0) {
      return 0;
    }

    if (k >= n) {
      return c / n;
    }

    const topKPasses = passes.slice(0, k);
    const topKPassCount = topKPasses.filter((pass) => pass).length;

    return topKPassCount / k;
  };

export const passAtK =
  (k: number): Collect.Exec<{ pass: boolean }, number> =>
  (results) => {
    const passes = results.map(({ grade }) => grade.pass);
    return calcPassAtK(k)(passes);
  };
