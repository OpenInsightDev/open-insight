import { Effect, Ref, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import type { Config } from "./config.ts";
import { Harness } from "@open-insight/core";
import * as Event from "#/event/index.ts";
import { TaskResult } from "./result.ts";
import * as Trail from "./trail.ts";

const makeBenchFields = Effect.fn(function* (bench: Bench.Bench) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
  };
});

export const make = Effect.fn(function* (bench: Bench.Bench, config: Config) {
  const { tasks, metrics } = bench;
  const { trailConcurrency } = config;

  const harness = yield* Harness.Service;

  const taskResultsRef = yield* Ref.make<TaskResult[]>([]);
  const trailSem = yield* Semaphore.make(trailConcurrency);
  const taskStreams = tasks.map((task) =>
    Trail.make({
      bench,
      task,
      config,
      trailSem,
    }),
  );

  const benchFields = yield* makeBenchFields(bench);
  const startEvent = Stream.succeed(
    Event.EvalStartEvent.make({
      ...benchFields,
      bench: bench.metadata,
      harness: harness.metadata,
      metrics: metrics.map((metric) => metric.metadata),
    }),
  );

  return Stream.empty.pipe(Stream.concat(startEvent));
}, Stream.unwrap);
