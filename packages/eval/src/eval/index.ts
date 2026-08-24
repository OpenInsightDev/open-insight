import { Data } from "effect";
import * as Bench from "#/bench/index.ts";
import { Harness } from "@open-insight/core/internal";

export class Eval<Bench extends Bench.Any, Harness extends Harness.Any> extends Data.Class<{
  bench: Bench;
  harness: Harness;
}> {}
