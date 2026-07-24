import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import type { Prompt } from "@open-insight/core/internal";
import { Array as Arr, Effect, Match, Option, Result, Schema, Stream } from "effect";
import { Metadata, type MetadataEncoded } from "./metadata.ts";
import { traj as whenTraj, type Context, type When } from "./when.ts";

const MetricResult = Schema.Record(Schema.String, Schema.Json);
type MetricResult = typeof MetricResult.Type;

const countToolRounds = (trajectory: Prompt.Trajectory): number =>
  trajectory.content.filter(({ role }) => role === "tool").length;

export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (
  context: Context,
) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  when: When;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type RunResult = readonly [Metric, MetricResult];

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;
  when?: When;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Options<R>,
) {
  const { exec, when = whenTraj(), chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options);
  return { exec, when, chart, metadata } satisfies Metric<R>;
});

const runMetric = Effect.fn("metric/traj/runMetric")(function* (metric: Metric, context: Context) {
  const result = yield* Effect.tryPromise(() => metric.exec(context)).pipe(
    Effect.flatMap(Schema.decodeEffect(MetricResult)),
  );
  return [metric, result] satisfies RunResult;
});

const runTrajMetric = Effect.fn("metric/traj/runTrajMetric")(function* (
  metric: Metric,
  context: Context,
) {
  return yield* Match.value(metric.when).pipe(
    Match.tag("Traj", (when) =>
      Effect.gen(function* () {
        if (!(yield* Effect.try(() => when.on(context.trajectory)))) {
          return Option.none<RunResult>();
        }
        if (!(yield* Effect.tryPromise(() => Promise.resolve(when.exec(context))))) {
          return Option.none<RunResult>();
        }
        return Option.some(yield* runMetric(metric, context));
      }),
    ),
    Match.tag("Schedule", () => Effect.succeed(Option.none<RunResult>())),
    Match.exhaustive,
  );
});

export const run = Effect.fn("metric/traj/run")(function* <E, R>(
  {
    metrics,
    context: currentContext,
  }: Readonly<{
    metrics: ReadonlyArray<Metric>;
    context: Effect.Effect<Context, E, R>;
  }>,
  before: Prompt.Trajectory,
) {
  const hasTrajMetrics = metrics.some(({ when }) =>
    Match.value(when).pipe(
      Match.tag("Traj", () => true),
      Match.tag("Schedule", () => false),
      Match.exhaustive,
    ),
  );
  if (!hasTrajMetrics) {
    return [];
  }

  const context = yield* currentContext;
  const toolRounds = countToolRounds(context.trajectory) - countToolRounds(before);
  return yield* Stream.range(0, toolRounds - 1).pipe(
    Stream.flatMap(() => Stream.fromIterable(metrics)),
    Stream.mapEffect((metric) => runTrajMetric(metric, context)),
    Stream.runCollect,
    Effect.map(Arr.getSomes),
  );
});

export const schedule = <E, R>(
  {
    metrics,
    context: currentContext,
  }: Readonly<{
    metrics: ReadonlyArray<Metric>;
    context: Effect.Effect<Context, E, R>;
  }>,
  halt: Effect.Effect<unknown>,
) => {
  type MetricStream = Stream.Stream<RunResult, E | Effect.Error<ReturnType<typeof runMetric>>, R>;

  const metricSchedules = metrics.flatMap(
    (metric): ReadonlyArray<MetricStream> =>
      Match.value(metric.when).pipe(
        Match.tag("Traj", () => Arr.empty<MetricStream>()),
        Match.tag("Schedule", (when) => {
          const pollMetric = Effect.fn("metric/traj/pollMetric")(function* () {
            const context = yield* currentContext;
            const shouldRun = yield* Effect.tryPromise(() => Promise.resolve(when.exec(context)));
            const result: Result.Result<RunResult, void> = shouldRun
              ? Result.succeed(yield* runMetric(metric, context))
              : Result.failVoid;
            return result;
          });

          const scheduleMetric = (): MetricStream =>
            Stream.suspend(() => {
              const scheduleStream = Stream.fromSchedule(when.schedule).pipe(
                Stream.interruptWhen(halt),
                Stream.mapEffect(pollMetric),
              );
              const retry = when.retry;
              if (retry === undefined) {
                return scheduleStream.pipe(Stream.filterMap((result) => result));
              }

              const retryStream = Stream.fromSchedule(retry).pipe(
                Stream.interruptWhen(halt),
                Stream.mapEffect(pollMetric),
                Stream.takeUntil(Result.isSuccess),
                Stream.filterMap((result) => result),
                Stream.flatMap((output) =>
                  Stream.succeed(output).pipe(Stream.concat(scheduleMetric())),
                ),
              );

              return scheduleStream.pipe(
                Stream.takeUntil(Result.isFailure),
                Stream.flatMap(
                  Result.match({
                    onFailure: () => retryStream,
                    onSuccess: (output) => Stream.succeed(output),
                  }),
                ),
              );
            });

          return [scheduleMetric()];
        }),
        Match.exhaustive,
      ),
  );

  return Stream.mergeAll(metricSchedules, { concurrency: "unbounded" });
};
