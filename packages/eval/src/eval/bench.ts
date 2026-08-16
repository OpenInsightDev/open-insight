import { Cause, Effect, Fiber, FileSystem, Path, pipe, PubSub, Semaphore, Stream } from "effect";
import * as Task from "#/task/index.ts";
import * as Bench from "#/bench/index.ts";
import type { Config } from "./config.ts";
import { Harness } from "@open-insight/core";
import * as Event from "#/event/index.ts";
import * as Metric from "#/metric/index.ts";
import { BenchResult, TaskResult } from "./result.ts";
import * as Trail from "./task.ts";
import { EvalError } from "./error.ts";
import type { Sandbox } from "@open-insight/core/internal";

const makeBenchFields = Effect.fn(function* (bench: Bench.Bench) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
  };
});

export const make = Effect.fn(
  function* (bench: Bench.Bench, config: Config) {
    const { tasks, metrics } = bench;
    const { trailConcurrency, snapshotConcurrency, trailCount } = config;

    const harness = yield* Harness.Service;

    const trailSem = yield* Semaphore.make(trailConcurrency);
    const snapSem = yield* Semaphore.make(snapshotConcurrency);

    const taskResultPubsub = yield* PubSub.unbounded<[Task.ID, Metric.Task.TrailResults]>();
    const taskResultsFiber = yield* Stream.fromPubSub(taskResultPubsub).pipe(
      Stream.runCollect,
      Effect.forkScoped,
    );

    const taskStreams = tasks.map((task) =>
      Trail.make({
        bench,
        task,
        config,
        snapSem,
        trailSem,
        trailCount,
      }).pipe(
        Stream.catchTag("Done", ({ value: result }) =>
          PubSub.publish(taskResultPubsub, [task.metadata.id, result.trails]).pipe(
            () => Stream.empty,
          ),
        ),
      ),
    );
    const mergedTaskEvents = Stream.mergeAll(taskStreams, { concurrency: tasks.length }).pipe(
      Stream.ensuring(PubSub.shutdown(taskResultPubsub)),
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

    const result = taskResultsFiber.pipe(
      Fiber.join,
      Effect.map((entries) =>
        pipe(
          entries.map(([id, trails]) => [id, TaskResult.make({ trails })] as const),
          Object.fromEntries<TaskResult>,
        ),
      ),
      Effect.flatMap((tasks) => Cause.done(BenchResult.make({ tasks }))),
      Stream.fromEffect,
    );

    const benchMetricStreams = metrics
      .map(Metric.Bench.makeStream(Stream.fromPubSub(taskResultPubsub)))
      .map(Stream.mapError(EvalError.metric));
    const benchMetricEvents = Stream.mergeAll(benchMetricStreams, {
      concurrency: "unbounded",
    }).pipe(Stream.map((result) => Event.BenchMetricEvent.make({ ...benchFields, ...result })));

    return Stream.empty.pipe(
      Stream.concat(startEvent),
      Stream.concat(mergedTaskEvents),
      Stream.concat(endEvent),
      Stream.concat(result),
      Stream.merge(benchMetricEvents),
    );
  },
  (eff, bench) =>
    eff.pipe(Stream.unwrap).pipe(
      Stream.catchIf(
        (error) => !Cause.isDone(error),
        (error) =>
          makeBenchFields(bench).pipe(
            Effect.flatMap((fields) =>
              Effect.fail(Event.BenchErrorEvent.make({ ...fields, error })),
            ),
            Stream.fromEffect,
          ),
      ),
    ) satisfies Stream.Stream<
      Event.EvalEvent,
      Event.EvalErrorEvent | Cause.Done<BenchResult>,
      FileSystem.FileSystem | Path.Path | Sandbox.ProviderService | Harness.Service
    >,
);
