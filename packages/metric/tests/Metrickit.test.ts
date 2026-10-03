import { assert, it } from "@effect/vitest";
import { Effect, Schedule, Schema, Stream } from "effect";
import type { Sandbox } from "@open-insight/sandbox";
import * as Metric from "#/Metric.ts";
import * as Metrickit from "#/Metrickit.ts";

// SAFETY: the metrics under test never read the sandbox, which only satisfies `Metric.transform`.
const sandbox = {} as Sandbox.Sandbox;

/** Emits one result per schedule tick, which makes a kit's metrics distinguishable. */
const ticks = (id: string, times: number) =>
  Metric.schedMetric(
    id,
    Schema.Number,
    (schedule) =>
      schedule.pipe(
        Stream.map(() => 1),
        Stream.mapError(Metric.MetricError.transform),
      ),
    { schedule: Schedule.recurs(times) },
  );

const resultIDs = (results: ReadonlyArray<{ id: string; result: number }>) =>
  results.map(({ id, result }) => `${id}:${result}`);

it.effect("runs every metric of a kit over the same trajectories", () =>
  Effect.gen(function* () {
    const kit = Metrickit.make(ticks("first", 2), ticks("second", 1));

    const stream = yield* Metrickit.run(kit, { trajectories: Stream.empty, sandbox });

    const results = yield* stream.pipe(
      Stream.runCollect,
      Effect.map((results) => Array.from(results)),
    );

    assert.deepStrictEqual(resultIDs(results).sort(), ["first:1", "first:1", "second:1"]);
  }),
);

it.effect("registers metrics over the ones already in a kit", () =>
  Effect.gen(function* () {
    const kit = Metrickit.register(ticks("first", 2))(Metrickit.make(ticks("first", 1)));

    const stream = yield* Metrickit.run(kit, { trajectories: Stream.empty, sandbox });

    const results = yield* stream.pipe(
      Stream.runCollect,
      Effect.map((results) => Array.from(results)),
    );

    assert.deepStrictEqual(resultIDs(results), ["first:1", "first:1"]);
  }),
);
