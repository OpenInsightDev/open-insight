import { Effect, Sink } from "effect";
import type { BenchResult } from "./result.ts";
import type { EvalEvent } from "./schema.ts";

export const make = (): Sink.Sink<BenchResult, EvalEvent, never> =>
  Effect.gen(function* () {
    throw new Error("Not implemented");
  }).pipe(Sink.fromEffect);
