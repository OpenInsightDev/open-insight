import * as Bench from "#/bench/index.ts";
import { Harness } from "@open-insight/core/internal";
import { Data } from "effect";

export class Eval<B extends Bench.Any, H extends Harness.Any> extends Data.Class<{
  bench: B;
  harness: H;
}> {}
export type Any = Eval<any, any>;

export type BenchOf<E> = E extends Eval<infer B, infer _> ? B : never;
export type HarnessOf<E> = E extends Eval<infer _, infer H> ? H : never;
