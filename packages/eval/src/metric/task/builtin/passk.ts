import {
  countCorrectBy,
  estimatePassAtK,
  estimatePassPowK,
  type BooleanField,
  type Pass,
} from "#/metric/common/passk.ts";
import type { TrailResult } from "#/eval/result.ts";
import type * as Grade from "#/grade/index.ts";
import type { Exec } from "../index.ts";

type PassAtK = Readonly<{ "pass@k": number }>;
type PassPowK = Readonly<{ "pass^k": number }>;

export function passAtK<G extends Pass>(k: number): Exec<G, PassAtK>;
export function passAtK<const Key extends string>(
  k: number,
  field: Key,
): Exec<BooleanField<Key>, PassAtK>;
export function passAtK(k: number, field = "pass") {
  return async (results: ReadonlyArray<TrailResult<Grade.Result>>): Promise<PassAtK> => {
    const total = results.length;
    const correct = countCorrectBy(results, (grade) => grade[field] === true);
    return { "pass@k": estimatePassAtK(total, correct, k) };
  };
}

export function passPowK<G extends Pass>(k: number): Exec<G, PassPowK>;
export function passPowK<const Key extends string>(
  k: number,
  field: Key,
): Exec<BooleanField<Key>, PassPowK>;
export function passPowK(k: number, field = "pass") {
  return async (results: ReadonlyArray<TrailResult<Grade.Result>>): Promise<PassPowK> => {
    const total = results.length;
    const correct = countCorrectBy(results, (grade) => grade[field] === true);
    return { "pass^k": estimatePassPowK(total, correct, k) };
  };
}
