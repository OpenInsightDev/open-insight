import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Sandbox } from "@open-insight/core/internal";
import { Metadata, Result, type MetadataEncoded } from "../schema.ts";
import { Effect, Schedule, Schema, Scope, Stream, SynchronizedRef } from "effect";
import { MetricError } from "../error.ts";

export type Exec<R extends Schema.Json = Schema.Json> = (
  sandbox: Sandbox.ReadonlySandboxPromise,
  prev: R | null,
) => R | Promise<R>;

export type Repeat = Schedule.Schedule<unknown>;

export type Metric<R extends Schema.Json = Schema.Json> = Readonly<{
  metadata: Metadata;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  repeat: Effect.Repeat.Options<R>;
  retry: Effect.Retry.Options<unknown>;
}>;

export type Options<R extends Schema.Json = Schema.Json> = Effect.Repeat.Options<R> &
  Readonly<{
    exec: Exec<R>;
    retry?: Effect.Retry.Options<unknown>;
    chart?: Chart.Chart<R> | null;
  }> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.Json = Schema.Json>(
  options: Options<R>,
): Effect.fn.Return<Metric<R>, MetricError> {
  const { exec, retry = {}, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(MetricError.metadata),
  );

  return {
    metadata,
    exec,
    chart,
    repeat: options,
    retry,
  } satisfies Metric<R>;
});

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
  ({
    exec,
    repeat,
    retry,
    metadata,
    chart,
  }: Metric): Stream.Stream<Result, MetricError, Scope.Scope> =>
    Effect.gen(function* () {
      const sbxPromise = yield* Sandbox.asPromise(sandbox).pipe(
        Effect.mapError(MetricError.sandbox),
      );

      const prevRef = yield* SynchronizedRef.make<Schema.Json | null>(null);

      const run = Effect.fn(function* (prev: Schema.Json | null) {
        const next = yield* Effect.tryPromise({
          try: () => Promise.resolve(exec(sbxPromise, prev)),
          catch: MetricError.exec(metadata.id),
        }).pipe(Effect.retry(retry));

        return next;
      });

      return prevRef.pipe(
        SynchronizedRef.updateAndGetEffect(run),
        (eff) => Stream.fromEffectSchedule(eff, repeatSchedule(repeat)),
        Stream.map((next) =>
          Result.make({
            metricID: metadata.id,
            value: next,
            chart: chart?.(next) ?? null,
          }),
        ),
      );
    }).pipe(Stream.unwrap);
