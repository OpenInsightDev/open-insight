import type * as Benchmark from "../benchmark/index.ts";
import type * as Harness from "../harness/index.ts";
import * as Metric from "../metric/index.ts";
import type * as Task from "../task/index.ts";
import type { Contravariant } from "../utils/variant.ts";
import { type Brand, Effect } from "effect";
import { ExecError } from "./error.ts";
import { EventTransportService, type EventTransport } from "./event/index.ts";
import { assertNonNull } from "@/utils/type.ts";
import { Layer } from "effect";

export type Executor<T extends Task.Task = Task.Task> = Readonly<{
  benchmark: Benchmark.Benchmark;
  harness: Harness.Harness;

  trailCount: number;
  metrics: Metric.Metrics<Task.GraderOf<T>> | null;
  // transport: EventTransport | null;
  transport: Layer.Layer<EventTransportService, ExecError> | null;
}> & { _T?: T };

type Builder<T extends Task.Task = Task.Task, H = never, R = never> = Effect.Effect<
  Partial<Executor<T>>,
  ExecError,
  R
> & { _typestate?: Contravariant<H>; _task?: T };

export const init = <T extends Task.Task>(): Builder<T> =>
  Effect.succeed({
    benchmark: undefined,
    harness: undefined,
  });

type HasBenchmark = Brand.Brand<"benchmark">;
export const withBenchmark =
  <T extends Task.Task, E, BR>(benchmark: Effect.Effect<Benchmark.Benchmark<T>, E, BR>) =>
  <H, R>(builder: Builder<T, H, R>): Builder<T, H | HasBenchmark, R | BR> =>
    Effect.gen(function* () {
      const exec = yield* builder;
      const b = yield* benchmark.pipe(Effect.mapError(ExecError.init));
      return { ...exec, benchmark: b };
    });

type HasHarness = Brand.Brand<"harness">;
export const withHarness =
  <T extends Task.Task, E, HR>(harness: Effect.Effect<Harness.Harness<T>, E, HR>) =>
  <H, R>(builder: Builder<T, H, R>): Builder<T, H | HasHarness, R | HR> =>
    Effect.gen(function* () {
      const exec = yield* builder;
      const h = yield* harness.pipe(Effect.mapError(ExecError.init));
      return { ...exec, harness: h };
    });

export const withTrailCount =
  (trailCount: number) =>
  <T extends Task.Task, H, R>(builder: Builder<T, H, R>): Builder<T, H, R> =>
    Effect.map(builder, (exec) => ({ ...exec, trailCount }));

export const withMetrics =
  <T extends Task.Task, TAM extends Metric.Task.Metric = never>(
    metrics: Effect.Effect<Metric.Metrics<Task.GraderOf<T>, TAM>>,
  ) =>
  <H, R>(builder: Builder<T, H, R>): Builder<T, H, R> =>
    Effect.gen(function* () {
      const exec = yield* builder;
      const m = yield* metrics.pipe(Effect.mapError(ExecError.init));
      return { ...exec, metrics: m };
    });

export const withTransport =
  <T extends Task.Task, E, TR>(transport: Effect.Effect<EventTransport, E, TR>) =>
  <H, R>(builder: Builder<T, H, R>): Builder<T, H, R | TR> =>
    Effect.gen(function* () {
      const exec = yield* builder;
      const t = yield* transport.pipe(Effect.mapError(ExecError.init));
      return { ...exec, transport: Layer.succeed(EventTransportService, t) };
    });

export const build = <T extends Task.Task, R>(
  builder: Builder<T, HasBenchmark | HasHarness, R>,
): Effect.Effect<Executor<T>, ExecError, R> =>
  Effect.gen(function* () {
    const {
      benchmark,
      harness,
      transport,
      metrics,
      trailCount = 1,
    } = yield* builder.pipe(Effect.mapError(ExecError.init));

    assertNonNull(benchmark);
    assertNonNull(harness);

    return {
      benchmark,
      harness,
      transport: transport ?? null,
      metrics: metrics ?? null,
      trailCount,
    };
  });
