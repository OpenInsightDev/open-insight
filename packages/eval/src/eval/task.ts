import * as Bench from "#/bench/index.ts";
import { produce } from "immer";
import type { Harness } from "@open-insight/core/internal";
import type { Override } from "../utils/type.ts";
import type { Any, BenchOf, Eval, HarnessOf } from "./eval.ts";

type MappedBench<E extends Any, Mapped extends Bench.Any> = Override<E, Eval<Mapped, HarnessOf<E>>>;

type MappedHarness<E extends Any, Mapped extends Harness.Any> = Override<
  E,
  Eval<BenchOf<E>, Mapped>
>;

export const mapBench =
  <E extends Any, Mapped extends Bench.Any>(mapper: (bench: BenchOf<E>, eval_: E) => Mapped) =>
  (eval_: E): MappedBench<E, Mapped> =>
    produce(eval_, (draft) => {
      draft.bench = mapper(draft.bench, eval_);
    });

export const mapHarness =
  <E extends Any, Mapped extends Harness.Any>(
    mapper: (harness: HarnessOf<E>, eval_: E) => Mapped,
  ) =>
  (eval_: E): MappedHarness<E, Mapped> =>
    produce(eval_, (draft) => {
      draft.harness = mapper(draft.harness, eval_);
    });
