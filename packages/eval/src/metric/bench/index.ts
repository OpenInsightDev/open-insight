import * as Chart from "#/chart/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import * as Grade from "#/grade/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";
import * as Task from "#/task/index.ts";
import { Crypto, Effect, Ref, Schema } from "effect";
import { Metadata, type MetadataEncoded } from "../metadata.ts";
import { Result, type StreamResult } from "../result.ts";
import { Error } from "../error.ts";

export type Delta<G extends Grade.Result = Grade.Result> = TrailResult<G> &
  Readonly<{ task: Task.ID }>;
export type Results<G extends Grade.Result = Grade.Result> = Readonly<
  Record<Task.ID, ReadonlyArray<TrailResult<G>>>
>;

/**
 * Computes a benchmark metric whenever a new task trail result is available.
 *
 * @param results All benchmark results collected so far, including the current `delta`.
 * @param delta The task trail result that triggered this computation.
 * @param prev The previous output of this metric, or `null` on its first execution.
 */
export type Exec<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = (results: Results<G>, delta: Delta<G>, prev: R | null) => Promise<R>;

export type ExecEffect<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Effect.Effect<Exec<G, R>>;

export const exec = <
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
>(
  fn: Exec<G, R>,
): ExecEffect<G, R> => Effect.succeed(fn);

export type Metric<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  exec: BivariantFn<Exec<G, R>>;
  chart: BivariantFn<Chart.Chart<R>> | null;
  metadata: Metadata;
}>;

export type Options<
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
> = Readonly<{
  exec: Exec<G, R>;
  chart?: Chart.Chart<R> | null;
}> &
  MetadataEncoded;

/** Maps benchmark grade results before passing them to another metric executor. */
export const mapGrade =
  <Input extends Grade.Result, Mapped extends Grade.Result, R extends Schema.JsonObject>(
    map: (grade: Input) => Mapped,
  ) =>
  (exec: ExecEffect<Mapped, R>): ExecEffect<Input, R> => {
    const mapTrail = (trail: TrailResult<Input>): TrailResult<Mapped> => ({
      ...trail,
      grade: map(trail.grade),
    });

    return exec.pipe(
      Effect.map(
        (exec) => async (results, delta, prev) =>
          exec(
            Object.fromEntries(
              Object.entries(results).map(([task, trails]) => [task, trails.map(mapTrail)]),
            ),
            { ...mapTrail(delta), task: delta.task },
            prev,
          ),
      ),
    );
  };

export const make = Effect.fn(function* <
  G extends Grade.Result = Grade.Result,
  R extends Schema.JsonObject = Schema.JsonObject,
>(options: Options<G, R>): Effect.fn.Return<Metric<G, R>, Error, Crypto.Crypto> {
  const { exec, chart = null } = options;
  const metadata = yield* Schema.decodeEffect(Metadata)(options).pipe(
    Effect.mapError(Error.metadata),
  );
  return { exec, chart, metadata } satisfies Metric<G, R>;
});

export const run = Effect.fn("metric/bench/run")(function* <
  G extends Grade.Result,
  R extends Schema.JsonObject,
>(metric: Metric<G, R>) {
  const state = yield* Ref.make<
    Readonly<{
      results: Results<G>;
      prev: R | null;
    }>
  >({ results: {}, prev: null });

  return Effect.fn(function* (delta: Delta<G>): Effect.fn.Return<StreamResult, Error> {
    const current = yield* Ref.get(state);
    const results = {
      ...current.results,
      [delta.task]: [...(current.results[delta.task] ?? []), delta],
    };

    const rawResult = yield* Effect.tryPromise(() =>
      metric.exec(results, delta, current.prev),
    ).pipe(Effect.mapError(Error.exec(metric.metadata.id)));
    const result = yield* Schema.decodeEffect(Result)(rawResult).pipe(
      Effect.mapError(Error.result(metric.metadata.id)),
      Effect.as(rawResult),
    );

    yield* Ref.set(state, { results, prev: result });

    const chart = yield* Effect.try(() => (metric.chart ? metric.chart(result) : null)).pipe(
      Effect.mapError(Error.chart(metric.metadata.id)),
    );

    return {
      id: metric.metadata.id,
      result,
      chart,
    } satisfies StreamResult;
  });
});

export * from "./builtin/index.ts";
