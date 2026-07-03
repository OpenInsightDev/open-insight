import type * as Benchmark from "../benchmark/index.ts";
import type * as Harness from "../harness/index.ts";
import type * as Metric from "../metric/index.ts";
import type * as Task from "../task/index.ts";
import { Effect, Layer, Option } from "effect";
import { ExecError } from "./error.ts";
import { EventTransportService } from "./event/index.ts";

export type Executor<T extends Task.Task = Task.Task> = Readonly<{
  benchmark: Benchmark.Benchmark;
  harness: Harness.Harness;
  trailCount: number;
  metrics: Option.Option<Metric.Metrics<Task.GraderOf<T>>>;
  transport: Option.Option<Layer.Layer<EventTransportService, ExecError>>;
}> & { _T?: T };

type Options<T extends Task.Task> = Readonly<{
  benchmark: Benchmark.Benchmark;
  harness: Harness.Harness;
  trailCount?: number;
  metrics?: Metric.Metrics<Task.GraderOf<T>>;
}>;

export const make = Effect.fn(function* <T extends Task.Task>({
  benchmark,
  harness,
  trailCount = 1,
  metrics,
}: Options<T>): Effect.fn.Return<Executor<T>, never, EventTransportService> {
  const transport = yield* Effect.serviceOption(EventTransportService);

  return {
    benchmark,
    harness,
    trailCount,
    metrics: Option.fromNullishOr(metrics),
    transport: transport.pipe(Option.map((t) => Layer.succeed(EventTransportService, t))),
  } satisfies Executor<T>;
});
