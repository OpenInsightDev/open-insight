import type * as Bench from "#/bench/index.ts";
import type * as Harness from "#/harness/index.ts";
import type * as Task from "#/task/index.ts";
import { Effect } from "effect";

export type Executor<T extends Task.Task = Task.Task> = Readonly<{
  benchmark: Bench.Bench;
  harness: Harness.Harness;
  trailCount: number;
}> & { _T?: T };

type Options<T extends Task.Task> = Readonly<{
  benchmark: Bench.Bench;
  harness: Harness.Harness;
  trailCount?: number;
}>;

export const make = Effect.fn(
  <T extends Task.Task>({ benchmark, harness, trailCount = 1 }: Options<T>) =>
    Effect.succeed({
      benchmark,
      harness,
      trailCount,
    } satisfies Executor<T>),
);
