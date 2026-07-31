import type * as Bench from "#/bench/index.ts";
import type * as Harness from "#/harness/index.ts";
import type * as Task from "#/task/index.ts";
import { Effect } from "effect";

export type Executor<T extends Task.AnyTask = Task.AnyTask> = Readonly<{
  bench: Bench.Bench;
  harness: Harness.Harness;
  trailCount: number;
}> & { _T?: T };

type Options = Readonly<{
  bench: Bench.Bench;
  harness: Harness.Harness;
  trailCount?: number;
}>;

export const make = Effect.fn(
  <T extends Task.AnyTask>({
    bench,
    harness,
    trailCount = 1,
  }: Options): Effect.Effect<Executor<T>> =>
    Effect.succeed({
      bench,
      harness,
      trailCount,
    } satisfies Executor<T>),
);
