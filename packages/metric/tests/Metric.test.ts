import { assert, it } from "@effect/vitest";
import { Effect, Predicate, Result, Schedule, Schema, Stream } from "effect";
import type { Sandbox } from "@open-insight/sandbox";
import { Prompt, Response, Trajectory } from "@open-insight/trajectory";
import * as Metric from "#/Metric.ts";

// SAFETY: both metrics under test never read the sandbox, which only satisfies `Metric.transform`.
const sandbox = {} as Sandbox.Sandbox;

/** Counts the response parts of every trajectory it observes. */
const responseCount = Metric.trajectoryMetric("responseCount", Schema.Number, (trajectory) =>
  trajectory.pipe(
    Stream.filterMap((part) =>
      Predicate.isTagged(part, "Response")
        ? Result.succeed({ result: 1, part })
        : Result.fail(part),
    ),
    Stream.mapError(Metric.MetricError.transform),
  ),
);

/** Emits one observation per schedule tick. */
const ticks = Metric.schedMetric(
  "ticks",
  Schema.Number,
  (schedule) =>
    schedule.pipe(
      Stream.map(() => 1),
      Stream.mapError(Metric.MetricError.transform),
    ),
  { schedule: Schedule.recurs(2) },
);

it.effect("references the trajectory part each observation came from", () =>
  Effect.gen(function* () {
    const responses = [
      Trajectory.responsePart(Response.makePart("text", { text: "first" })),
      Trajectory.responsePart(Response.makePart("text", { text: "second" })),
    ];

    const trajectory = Stream.fromIterable<Trajectory.AnyPart>([
      Trajectory.promptPart(Prompt.make("count these")),
      ...responses,
    ]);

    const results = yield* responseCount.transform(Stream.make(trajectory), sandbox).pipe(
      Stream.runCollect,
      Effect.map((results) => Array.from(results)),
    );

    assert.deepStrictEqual(
      results.map(({ id, result, partID, timestamp }) => ({ id, result, partID, timestamp })),
      responses.map(({ uuid, timestamp }) => ({
        id: responseCount.id,
        result: 1,
        partID: uuid,
        timestamp,
      })),
    );
  }),
);

it.effect("timestamps one result per schedule tick", () =>
  Effect.gen(function* () {
    const results = yield* ticks.transform(Stream.empty, sandbox).pipe(
      Stream.runCollect,
      Effect.map((results) => Array.from(results)),
    );

    assert.deepStrictEqual(
      results.map(({ id, result }) => ({ id, result })),
      [
        { id: ticks.id, result: 1 },
        { id: ticks.id, result: 1 },
      ],
    );
  }),
);
