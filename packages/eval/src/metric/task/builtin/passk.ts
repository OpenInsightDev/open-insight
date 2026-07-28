import {
  countCorrect,
  estimatePassAtK,
  estimatePassPowK,
  type Pass,
} from "#/metric/common/passk.ts";
import { Effect } from "effect";
import type { Exec, ExecEffect } from "../index.ts";

type PassAtK = Readonly<{ "pass@k": number }>;
type PassPowK = Readonly<{ "pass^k": number }>;

export const passAtK = <G extends Pass>(k: number): ExecEffect<G, PassAtK> =>
  Effect.succeed(async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass@k": estimatePassAtK(total, correct, k) };
  });

export const passPowK = <G extends Pass>(k: number): ExecEffect<G, PassPowK> =>
  Effect.succeed(async (results) => {
    const total = results.length;
    const correct = countCorrect(results);
    return { "pass^k": estimatePassPowK(total, correct, k) };
  });
