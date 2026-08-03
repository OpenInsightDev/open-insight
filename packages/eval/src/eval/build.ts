import { Effect } from "effect";
import type * as Bench from "#/bench/index.ts";
import type * as Task from "#/task/index.ts";

export type Executor<T extends Task.AnyTask = Task.AnyTask> = Readonly<{
  bench: Bench.Bench;
  harnessId: string;
  trailCount: number;
}> & { _T?: T };

type Options<T extends Task.AnyTask> = Readonly<{
  bench: Bench.Bench;
  harnessId: string;
  trailCount?: number;
}>;

export const make = Effect.fn(
  <T extends Task.AnyTask>({
    bench,
    harnessId,
    trailCount = 1,
  }: Options<T>): Effect.Effect<Executor<T>> =>
    Effect.succeed({
      bench,
      harnessId,
      trailCount,
    }),
);
