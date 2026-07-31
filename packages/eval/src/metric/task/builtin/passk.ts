import {
  countCorrect,
  estimatePassAtK,
  estimatePassPowK,
  type Pass,
} from "#/metric/common/passk.ts";
import type { Exec } from "../index.ts";

type PassAtK = Readonly<{ "pass@k": number }>;
type PassPowK = Readonly<{ "pass^k": number }>;

export const passAtK =
  <G extends Pass>(k: number): Exec<G, PassAtK> =>
  async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass@k": estimatePassAtK(total, correct, k) };
  };

export const passPowK =
  <G extends Pass>(k: number): Exec<G, PassPowK> =>
  async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass^k": estimatePassPowK(total, correct, k) };
  };
