import { Effect } from "effect";
import { type Any } from "./eval.ts";

type SessionOptions = Readonly<{}>;
const makeSession = Effect.fn(function* (options: SessionOptions) {});

type TrailOptions = Readonly<{}>;
const makeTrail = Effect.fn(function* (options: TrailOptions) {});

type TaskOptions = Readonly<{}>;
const makeTask = Effect.fn(function* (options: TaskOptions) {});

type EvalOptions<Eval extends Any> = Readonly<{
  eval: Eval;
}>;
export const make = Effect.fn(function* <Eval extends Any>(options: EvalOptions<Eval>) {});
