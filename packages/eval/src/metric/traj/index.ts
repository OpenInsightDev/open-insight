import * as Chart from "#/chart/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import { Prompt } from "@open-insight/core/internal";
import { Array as Arr, Effect, Match, Option, Ref, Schema, Stream } from "effect";
import type { SchemaError } from "effect/SchemaError";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import { Result, type StreamResult } from "../result.ts";
import * as When from "../when/index.ts";
import { Error } from "../error.ts";

type Context = When.SandboxContext &
  Readonly<{ parts: Prompt.Parts; prevTrajectory: Prompt.Trajectory }>;

/**
 * Computes a trajectory metric whenever its trigger matches.
 *
 * @param context The sandbox, previous trajectory, and current response parts observed so far.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<R extends Schema.JsonObject = Schema.JsonObject> = (
  context: Context,
  prev: R | null,
) => Promise<R>;

export type Metric<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  when: When.When;
  exec: BivariantFn<Exec<R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options<R extends Schema.JsonObject = Schema.JsonObject> = Readonly<{
  exec: Exec<R>;
  when?: When.When;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

export const make = Effect.fn(function* <R extends Schema.JsonObject = Schema.JsonObject>(
  options: Options<R>,
) {
  const { exec, when = When.traj(When.part()), chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  return { exec, when, chart, metadata } satisfies Metric<R>;
});

const execMetric = Effect.fn("metric/traj/execMetric")(function* (
  metric: Metric,
  context: Context,
  prev: Result | null,
  state: Ref.Ref<ReadonlyMap<Metric, Result>>,
): Effect.fn.Return<StreamResult, Error> {
  const rawResult = yield* Effect.tryPromise(() => metric.exec(context, prev)).pipe(
    Effect.mapError(Error.exec(metric.metadata.id)),
  );
  const result = yield* Schema.decodeEffect(Result)(rawResult).pipe(
    Effect.mapError(Error.result(metric.metadata.id)),
    Effect.as(rawResult),
  );

  yield* Ref.update(state, (state) => new Map(state).set(metric, result));

  const chart = yield* Effect.try(() => (metric.chart ? metric.chart(result) : null)).pipe(
    Effect.mapError(Error.chart(metric.metadata.id)),
  );

  return {
    id: metric.metadata.id,
    result,
    chart,
  } satisfies StreamResult;
});

const runMetric = Effect.fn("metric/traj/runMetric")(function* (
  metric: Metric,
  pred: When.Pred | undefined,
  context: Context,
  state: Ref.Ref<ReadonlyMap<Metric, Result>>,
): Effect.fn.Return<Option.Option<StreamResult>, Error> {
  const matches = yield* Effect.tryPromise(() => Promise.resolve(pred?.(context) ?? true)).pipe(
    Effect.mapError(Error.exec(metric.metadata.id)),
  );

  if (!matches) {
    return Option.none();
  }

  const prev = (yield* Ref.get(state)).get(metric) ?? null;
  return Option.some(yield* execMetric(metric, context, prev, state));
});

export type RunOptions = Readonly<{
  metrics: ReadonlyArray<Metric>;
  sandbox: When.SandboxContext;
  prevTrajectory: Prompt.Trajectory;
}>;

export const run = ({ metrics, sandbox, prevTrajectory }: RunOptions) =>
  Effect.fn(
    function* <E, R>(
      stream: Prompt.PartEncodedStream<E, R>,
    ): Effect.fn.Return<Stream.Stream<StreamResult, Error | SchemaError | E, R>> {
      const partsRef = yield* Ref.make<Prompt.Parts>([]);
      const state = yield* Ref.make<ReadonlyMap<Metric, Result>>(new Map());
      const runPart = (metric: Metric, part: Prompt.Part, parts: Prompt.Parts) =>
        Match.valueTags(metric.when, {
          Traj: (when) =>
            Effect.try(() => when.trajPred(part, parts)).pipe(
              Effect.mapError(Error.exec(metric.metadata.id)),
              Effect.flatMap((matches) =>
                matches
                  ? runMetric(metric, when.pred, { ...sandbox, parts, prevTrajectory }, state)
                  : Effect.succeed(Option.none()),
              ),
            ),
          Schedule: () => Effect.succeed(Option.none()),
        });

      const scheduleStream = (metric: Metric) =>
        Match.valueTags(metric.when, {
          Traj: () => Stream.empty,
          Schedule: (when) =>
            Stream.fromSchedule(when.schedule).pipe(
              Stream.mapEffect(() =>
                Ref.get(partsRef).pipe(
                  Effect.flatMap((parts) =>
                    runMetric(metric, when.pred, { ...sandbox, parts, prevTrajectory }, state),
                  ),
                ),
              ),
              Stream.map(Option.toArray),
              Stream.flatMap(Stream.fromIterable),
            ),
        });

      // Consume the trajectory once and dispatch each metric when its trigger is available.
      const trajResults = stream.pipe(
        Stream.mapEffect((encoded) => Schema.decodeEffect(Prompt.PartDecoded)(encoded)),
        Stream.mapEffect((part) =>
          Ref.updateAndGet(partsRef, (parts) => [...parts, part]).pipe(
            Effect.flatMap((parts) =>
              Effect.forEach(metrics, (metric) => runPart(metric, part, parts), {
                concurrency: "unbounded",
              }),
            ),
            Effect.map(Arr.getSomes),
          ),
        ),
        Stream.flatMap(Stream.fromIterable),
      );

      // Scheduled metrics have independent clocks; merging with trajectory results bounds their lifetime.
      const scheduleResults = Stream.mergeAll(metrics.map(scheduleStream), {
        concurrency: "unbounded",
      });

      return Stream.merge(trajResults, scheduleResults, {
        // The trajectory owns the lifecycle; stop polling when it completes or fails.
        haltStrategy: "left",
      });
    },
    (effect) => effect.pipe(Stream.unwrap),
  );

export * from "./builtin/index.ts";
