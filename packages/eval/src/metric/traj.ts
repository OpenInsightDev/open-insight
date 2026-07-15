import type { Prompt } from "@open-insight/core";
import type { Bivariant } from "#/utils/variant.ts";
import { MetricError } from "./error.ts";
import { type Input, TrajOutput } from "./schema.ts";
import type * as _Core from "@open-insight/core";
import { Effect, type Stream } from "effect";
import type { UnionToIntersection } from "effect/Types";

type StreamInput = Readonly<{
  /**
   * Current trajectory, including all messages generated so far.
   */
  trajectory: Prompt.Trajectory;
  /**
   * Newly generated messages.
   */
  messages: ReadonlyArray<Prompt.Message>;
}>;
type BulkInput = Readonly<{
  trajectory: Prompt.Trajectory;
}>;

export type ReduceFn<R> = (prev: R, input: StreamInput) => PromiseLike<R> | R;
export type EachFn<R> = (input: StreamInput) => PromiseLike<R> | R;
export type BulkFn<R> = (input: BulkInput) => PromiseLike<R> | R;

export type ReduceMetric<
  N extends string = string, // metric name
  R = unknown, // metric result
> = Readonly<{
  name: N;
  prev: R;
  exec: Bivariant<ReduceFn<R>>;
}> & { _N?: N; _R?: R };
type ReduceMetricResult<R> =
  R extends ReduceMetric<infer N, infer R> ? UnionToIntersection<{ [K in N]: R }> : never;

export type EachMetric<N extends string = string, R = unknown> = Readonly<{
  name: N;
  exec: Bivariant<EachFn<R>>;
}> & { _N?: N; _R?: R };
type EachMetricResult<R> =
  R extends EachMetric<infer N, infer R> ? UnionToIntersection<{ [K in N]: R }> : never;

export type BulkMetric<N extends string = string, R = unknown> = Readonly<{
  name: N;
  exec: Bivariant<BulkFn<R>>;
}> & { _N?: N; _R?: R };
type BulkMetricResult<R> =
  R extends BulkMetric<infer N, infer R> ? UnionToIntersection<{ [K in N]: R }> : never;

export type Metrics<
  R extends ReduceMetric = never,
  E extends EachMetric = never,
  B extends BulkMetric = never,
> = Readonly<{
  reduce: ReadonlyArray<R>;
  each: ReadonlyArray<E>;
  bulk: ReadonlyArray<B>;
}>;

type StreamResult<M> =
  M extends Metrics<infer R, infer E, infer _B>
    ? ReduceMetricResult<R> & EachMetricResult<E>
    : never;
type BulkResult<M> =
  M extends Metrics<infer R, infer E, infer B>
    ? ReduceMetricResult<R> & EachMetricResult<E> & BulkMetricResult<B>
    : never;

export const tap = ({
  out,
  metrics: { reduce, bulk, each },
}: {
  out: Stream.Stream<TrajOutput, MetricError>;
  metrics: Metrics;
}) =>
  Effect.fn(function* <E, R>(
    stream: Stream.Stream<Input, E, R>,
  ): Effect.fn.Return<Stream.Stream<Input, E, R>, MetricError> {
    return stream;
  });
