import { Effect } from "effect";
import * as Bench from "#/bench/index.ts";
import * as Harness from "#/harness/index.ts";

type Options = Readonly<{
  benches: ReadonlyArray<Bench.Bench>;
  harnesses: ReadonlyArray<Harness.Harness>;
}>;

export const run = Effect.fn(function* ({ benches, harnesses }: Options) {});
