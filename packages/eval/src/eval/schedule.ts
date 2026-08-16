import { Cause, Effect, FileSystem, Path, Queue, Semaphore, Stream, SubscriptionRef } from "effect";
import * as Bench from "#/bench/index.ts";
import type { Config } from "./config.ts";
import { Harness } from "@open-insight/core";
import * as Event from "#/event/index.ts";
import * as Metric from "#/metric/index.ts";
import { BenchResult, TaskResult } from "./result.ts";
import * as Trail from "./trail.ts";
import { Sandbox } from "@open-insight/core/internal";
import { castDraft, produce } from "immer";
import { EvalError } from "./error.ts";

const makeBenchFields = Effect.fn(function* (bench: Bench.Bench) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
  };
});

export const makeStream = Effect.fn(function* (bench: Bench.Bench, config: Config) {
  const { tasks, metrics } = bench;
  const { trailConcurrency, snapshotConcurrency, trailCount } = config;

  const harness = yield* Harness.Service;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sbxProvider = yield* Sandbox.ProviderService;

  const taskResultsRef = yield* SubscriptionRef.make<Record<string, TaskResult>>({});
  const taskMetricResultsRef = yield* SubscriptionRef.make<Metric.Bench.BenchResult>({});
  const taskMetricQueue = yield* Queue.unbounded<Metric.Bench.BenchResult, Cause.Done>();

  const trailSem = yield* Semaphore.make(trailConcurrency);
  const snapSem = yield* Semaphore.make(snapshotConcurrency);

  const taskStreams = tasks.map((task) =>
    Trail.makeStream({
      bench,
      task,
      config,
      trailSem,
      snapSem,
      trailCount,
    })
      .pipe(
        Stream.catchTag("Done", ({ value: result }) =>
          Stream.fromEffect(
            Effect.gen(function* () {
              yield* SubscriptionRef.update(
                taskResultsRef,
                produce((results) => {
                  results[task.metadata.id] = castDraft(result);
                }),
              );
              const metricResults = yield* SubscriptionRef.updateAndGet(
                taskMetricResultsRef,
                (results) => ({
                  ...results,
                  [task.metadata.id]: result.trails,
                }),
              );
              yield* Queue.offer(taskMetricQueue, metricResults);
            }),
          ).pipe(Stream.drain),
        ),
      )
      .pipe(
        Stream.provideService(Harness.Service, harness),
        Stream.provideService(FileSystem.FileSystem, fs),
        Stream.provideService(Path.Path, path),
        Stream.provideService(Sandbox.ProviderService, sbxProvider),
      ),
  );
  const mergedTaskStream = Stream.mergeAll(taskStreams, { concurrency: tasks.length }).pipe(
    Stream.ensuring(Queue.end(taskMetricQueue)),
  );

  const benchFields = yield* makeBenchFields(bench);

  const startEvent = Stream.succeed(
    Event.BenchStartEvent.make({
      ...benchFields,
      bench: bench.metadata,
      harness: harness.metadata,
      metrics: metrics.map((metric) => metric.metadata),
    }),
  );

  const endEvent = Stream.succeed(Event.BenchEndEvent.make({ ...benchFields }));

  const result = SubscriptionRef.get(taskResultsRef)
    .pipe(Effect.flatMap((results) => Cause.done(BenchResult.make({ tasks: results }))))
    .pipe(Stream.fromEffect);

  const taskMetricResultsStreams =
    metrics.length === 0
      ? []
      : yield* Stream.fromQueue(taskMetricQueue).pipe(
          Stream.broadcastN({ n: metrics.length, capacity: "unbounded" }),
        );
  const benchMetricStreams = metrics
    .map((metric, index) => Metric.Bench.makeStream(taskMetricResultsStreams[index]!)(metric))
    .map(Stream.mapError(EvalError.metric));
  const benchMetricEvents = Stream.mergeAll(benchMetricStreams, {
    concurrency: "unbounded",
  }).pipe(Stream.map((result) => Event.BenchMetricEvent.make({ ...benchFields, ...result })));
  const taskAndMetricEvents = mergedTaskStream.pipe(Stream.merge(benchMetricEvents));

  return Stream.empty.pipe(
    Stream.concat(startEvent),
    Stream.concat(taskAndMetricEvents),
    Stream.concat(endEvent),
    Stream.concat(result),
  );
}, Stream.unwrap);
