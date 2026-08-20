import * as Chart from "#/chart/index.ts";
import * as Task from "#/task/index.ts";
import { Effect, Schema, Stream } from "effect";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";

export type BenchResult<G = unknown> = Readonly<Record<Task.ID, G[]>>;
export type Delta<G = unknown> = Readonly<[Task.ID, G[]]>;

type Output<S = unknown, R extends Schema.Json = any> = [state: S, output: R[]];

export type Exec<S = unknown, G = unknown, R extends Schema.Json = any> = (
  state: S,
  delta: Delta<G>,
) => Output<S, R> | PromiseLike<Output<S, R>>;

export type Metric<S = unknown, G = unknown, R extends Schema.Json = any> = Readonly<{
  initState: S;
  exec: Exec<S, G, R>;

  metadata: Metadata;
  chart: Chart.Chart<R> | null;
}>;

type Options<R extends Schema.Json> = MetadataEncoded &
  Readonly<{
    chart?: Chart.Chart<R> | null;
  }>;

export const makeAccum = Effect.fn(function* <G, S, R extends Schema.Json>(
  initState: () => S,
  exec: Exec<S, G, R>,
  options: Options<R> = {},
) {
  const { chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return {
    initState: initState(),
    exec,
    metadata,
    chart,
  } satisfies Metric<S, G, R>;
});

type MapExec<G = unknown, R extends Schema.Json = any> = (
  delta: Delta<G>,
  results: Delta<G>[],
) => R | PromiseLike<R>;
export const fromMapExec = <G, R extends Schema.Json>(
  exec: MapExec<G, R>,
): Exec<Delta<G>[], G, R> => {
  return async (state: Delta<G>[], delta: Delta<G>) => {
    const output = exec(delta, state);
    return [state, [await Promise.resolve(output)]];
  };
};

export const makeMap = <G, R extends Schema.Json>(
  exec: MapExec<G, R>,
  options: Options<R> = {},
) => {
  return makeAccum(() => [], fromMapExec(exec), options);
};

type ReduceExec<G = unknown, R extends Schema.Json = any> = (
  delta: Delta<G>,
  prev: R,
) => R | PromiseLike<R>;
export const fromReduceExec = <G, R extends Schema.Json>(exec: ReduceExec<G, R>): Exec<R, G, R> => {
  return async (state: R, delta: Delta<G>) => {
    const output = exec(delta, state);
    return [await Promise.resolve(output), [await Promise.resolve(output)]];
  };
};

export const makeReduce = <G, R extends Schema.Json>(
  initState: () => R,
  exec: ReduceExec<G, R>,
  options: Options<R> = {},
) => {
  return makeAccum(initState, fromReduceExec(exec), options);
};

type CollectExec<G = unknown, R extends Schema.Json = any> = (
  results: BenchResult<G>,
) => R | PromiseLike<R>;
export const fromCollectExec = <G, R extends Schema.Json>(
  exec: CollectExec<G, R>,
): Exec<BenchResult<G>, G, R> => {
  return async (state: BenchResult<G>, delta: Delta<G>) => {
    const nextState = { ...state, [delta[0]]: delta[1] };
    const output = exec(nextState);
    return [nextState, [await Promise.resolve(output)]];
  };
};

export const makeCollect = <G, R extends Schema.Json>(
  exec: CollectExec<G, R>,
  options: Options<R> = {},
) => {
  return makeAccum(() => ({}) as BenchResult<G>, fromCollectExec(exec), options);
};

export const makeStream =
  <G = unknown, E = never, R = never>(stream: Stream.Stream<Delta<G>, E, R>) =>
  <S, MR extends Schema.Json>(
    metric: Metric<S, G, MR>,
  ): Stream.Stream<Result, E | MetricError, R> => {
    return stream.pipe(
      Stream.mapAccumEffect(
        () => metric.initState,
        (state, delta) =>
          Effect.tryPromise({
            try: () => Promise.resolve(metric.exec(state, delta)),
            catch: MetricError.exec(metric.metadata.id),
          }).pipe(
            Effect.map(([nextState, outputs]) => [
              nextState,
              outputs.map((value) =>
                Result.make({
                  metricID: metric.metadata.id,
                  value,
                  chart: metric.chart?.(value) ?? null,
                }),
              ),
            ]),
          ),
      ),
    );
  };

type Mapper<A, B> = (input: A) => B;
const mapExec = <G, S, M, R extends Schema.Json>(
  mapper: Mapper<Delta<G>, Delta<M>>,
  exec: Exec<S, M, R>,
): Exec<S, G, R> => {
  return (state: S, delta: Delta<G>) => exec(state, mapper(delta));
};
export const mapGrade = <G, S, M, R extends Schema.Json>(
  mapper: Mapper<Delta<G>, Delta<M>>,
  metric: Metric<S, M, R>,
): Metric<S, G, R> => {
  return {
    ...metric,
    exec: mapExec(mapper, metric.exec),
  };
};

export * from "./builtin/index.ts";
