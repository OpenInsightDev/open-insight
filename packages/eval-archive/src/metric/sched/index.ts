import * as Chart from "#/chart/index.ts";
import { Sandbox } from "@open-insight/core/internal";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { Effect, Schedule, Schema, Scope, Stream, SynchronizedRef } from "effect";
import { MetricError } from "../error.ts";

type Output<S = unknown, R extends Schema.Json = any> = [state: S, output: R[]];

export type Exec<S = unknown, R extends Schema.Json = any> = (
  state: S,
  sandbox: Sandbox.ReadonlySandboxPromise,
) => Output<S, R> | PromiseLike<Output<S, R>>;

export type Metric<S = unknown, R extends Schema.Json = any> = Readonly<{
  initState: S;
  exec: Exec<S, R>;

  metadata: Metadata;
  chart: Chart.Chart<R> | null;
  repeat: Effect.Repeat.Options<R>;
  retry: Effect.Retry.Options<unknown>;
}>;

type Options<R extends Schema.Json> = Effect.Repeat.Options<R> &
  MetadataEncoded &
  Readonly<{
    chart?: Chart.Chart<R> | null;
    retry?: Effect.Retry.Options<unknown>;
  }>;

export const makeAccum = Effect.fn(function* <S, R extends Schema.Json>(
  initState: () => S,
  exec: Exec<S, R>,
  options: Options<R> = {},
) {
  const { chart = null, retry = {} } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return {
    initState: initState(),
    exec,
    metadata,
    chart,
    repeat: options,
    retry,
  } satisfies Metric<S, R>;
});

type MapExec<R extends Schema.Json = any> = (
  sandbox: Sandbox.ReadonlySandboxPromise,
  results: Sandbox.ReadonlySandboxPromise[],
) => R | PromiseLike<R>;
export const fromMapExec = <R extends Schema.Json>(
  exec: MapExec<R>,
): Exec<Sandbox.ReadonlySandboxPromise[], R> => {
  return async (
    state: Sandbox.ReadonlySandboxPromise[],
    sandbox: Sandbox.ReadonlySandboxPromise,
  ) => {
    const output = exec(sandbox, state);
    return [state, [await Promise.resolve(output)]];
  };
};

export const makeMap = <R extends Schema.Json>(exec: MapExec<R>, options: Options<R> = {}) => {
  return makeAccum(() => [], fromMapExec(exec), options);
};

type ReduceExec<R extends Schema.Json = any> = (
  sandbox: Sandbox.ReadonlySandboxPromise,
  prev: R,
) => R | PromiseLike<R>;
export const fromReduceExec = <R extends Schema.Json>(exec: ReduceExec<R>): Exec<R, R> => {
  return async (state: R, sandbox: Sandbox.ReadonlySandboxPromise) => {
    const output = exec(sandbox, state);
    return [await Promise.resolve(output), [await Promise.resolve(output)]];
  };
};

export const makeReduce = <R extends Schema.Json>(
  initState: () => R,
  exec: ReduceExec<R>,
  options: Options<R> = {},
) => {
  return makeAccum(initState, fromReduceExec(exec), options);
};

const repeatSchedule = <A>(options: Effect.Repeat.Options<A>) => {
  const fallback = Schedule.forever.pipe(Schedule.setInputType<A>());
  let schedule = Schedule.passthrough(options.schedule ?? fallback);

  if (options.while) {
    schedule = schedule.pipe(Schedule.while(({ input }) => options.while!(input)));
  }
  if (options.until) {
    schedule = schedule.pipe(
      Schedule.while(({ input }) => {
        const done = options.until!(input);
        return Effect.isEffect(done) ? Effect.map(done, (value) => !value) : !done;
      }),
    );
  }
  if (options.times !== undefined) {
    schedule = schedule.pipe(Schedule.while(({ attempt }) => attempt <= options.times!));
  }

  return schedule;
};

export const makeStream =
  (sandbox: Sandbox.Sandbox) =>
  <S, R extends Schema.Json>(
    metric: Metric<S, R>,
  ): Stream.Stream<Result, MetricError, Scope.Scope> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const sbxPromise = yield* Sandbox.asPromise(sandbox).pipe(
          Effect.mapError(MetricError.sandbox),
        );

        const stateRef = yield* SynchronizedRef.make<S>(metric.initState);

        const run = Effect.gen(function* () {
          const state = yield* SynchronizedRef.get(stateRef);
          const [nextState, outputs] = yield* Effect.tryPromise({
            try: () => Promise.resolve(metric.exec(state, sbxPromise)),
            catch: MetricError.exec(metric.metadata.id),
          }).pipe(Effect.retry(metric.retry));

          yield* SynchronizedRef.set(stateRef, nextState);
          return outputs;
        });

        return Stream.fromSchedule(Schedule.forever).pipe(
          Stream.mapEffect(() => run),
          Stream.flatMap((outputs: R[]) => Stream.fromIterable(outputs)),
          Stream.map((value: R) =>
            Result.make({
              metricID: metric.metadata.id,
              value,
              chart: metric.chart?.(value) ?? null,
            }),
          ),
        );
      }),
    );
