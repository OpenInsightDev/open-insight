import type * as Bench from "#/bench/index.ts";
import type * as Harness from "#/harness/index.ts";
import type * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import { Effect, Option } from "effect";

export type Executor<T extends Task.Task = Task.Task> = Readonly<{
  benchmark: Bench.Bench;
  harness: Harness.Harness;
  trailCount: number;
  metrics: Option.Option<Metric.Metrics<Task.GradeResultOf<T>>>;
}> & { _T?: T };

type Options<T extends Task.Task> = Readonly<{
  benchmark: Bench.Bench;
  harness: Harness.Harness;
  trailCount?: number;
  metrics?: Metric.Metrics<Task.GradeResultOf<T>>;
}>;

export const make = Effect.fn(
  <T extends Task.Task>({ benchmark, harness, trailCount = 1, metrics }: Options<T>) =>
    Effect.succeed({
      benchmark,
      harness,
      trailCount,
      metrics: Option.fromNullishOr(metrics),
    } satisfies Executor<T>),
);
