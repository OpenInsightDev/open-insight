import * as Chart from "#/chart/index.ts";
import { Effect, Schema, Stream } from "effect";
import { Metadata, type MetadataEncoded } from "../schema.ts";
import { MetricError } from "../error.ts";

type Output<S = unknown, R extends Schema.Json = any> = [state: S, output: R[]];

export type Exec<S = unknown, G = unknown, R extends Schema.Json = any> = (
  state: S,
  delta: G,
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
  delta: G,
  results: G[],
) => R | PromiseLike<R>;
export const fromMapExec = <G, R extends Schema.Json>(exec: MapExec<G, R>): Exec<G[], G, R> => {
  return async (state: G[], delta: G) => {
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
  delta: G,
  prev: R,
) => R | PromiseLike<R>;
export const fromReduceExec = <G, R extends Schema.Json>(exec: ReduceExec<G, R>): Exec<R, G, R> => {
  return async (state: R, delta: G) => {
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

export const makeStream =
  <G, S, MR extends Schema.Json, E, R>(stream: Stream.Stream<G, E, R>) =>
  (metric: Metric<S, G, MR>): Stream.Stream<MR, E | MetricError, R> => {
    return stream.pipe(
      Stream.mapAccumEffect(
        () => metric.initState,
        (state, delta) =>
          Effect.tryPromise({
            try: () => Promise.resolve(metric.exec(state, delta)),
            catch: MetricError.exec(metric.metadata.id),
          }),
      ),
    );
  };

type Mapper<A, B> = (input: A) => B;
const mapExec = <G, S, M, R extends Schema.Json>(
  mapper: Mapper<G, M>,
  exec: Exec<S, M, R>,
): Exec<S, G, R> => {
  return (state: S, delta: G) => exec(state, mapper(delta));
};
export const mapGrade = <G, S, M, R extends Schema.Json>(
  mapper: Mapper<G, M>,
  metric: Metric<S, M, R>,
): Metric<S, G, R> => {
  return {
    ...metric,
    exec: mapExec(mapper, metric.exec),
  };
};
