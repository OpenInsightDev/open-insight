import {
  countCorrect,
  estimatePassAtK,
  estimatePassPowK,
  type Pass,
} from "#/metric/common/passk.ts";
import { exec, type ExecEffect } from "../index.ts";

type PassAtK = Readonly<{ "pass@k": number }>;
type PassPowK = Readonly<{ "pass^k": number }>;

export const passAtK = <G extends Pass>(k: number): ExecEffect<G, PassAtK> =>
  exec<G, PassAtK>(async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass@k": estimatePassAtK(total, correct, k) };
  });

export const passPowK = <G extends Pass>(k: number): ExecEffect<G, PassPowK> =>
  exec<G, PassPowK>(async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass^k": estimatePassPowK(total, correct, k) };
  });
