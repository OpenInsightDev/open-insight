import { Cause, Effect, Fiber, Option, pipe, PubSub, Semaphore, Stream } from "effect";
import * as Task from "#/task/index.ts";
import * as Bench from "#/bench/index.ts";
import * as Event from "#/event/index.ts";
import * as Metric from "#/metric/index.ts";
import * as Trail from "./task.ts";
import type { Config } from "./config.ts";
import { EvalError } from "./error.ts";
import { Harness } from "@open-insight/core/internal";

const makeBenchFields = Effect.fn(function* (bench: Bench.Bench) {
  const harness = yield* Harness.Service;
  return {
    benchId: bench.metadata.id,
    harnessId: harness.metadata.id,
  };
});

export const make = Effect.fn(function* (bench: Bench.Bench, config: Config) {
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
        PubSub.publish(taskResultPubsub, [task.metadata.id, result.trails] as const).pipe(
          () => Stream.empty,
        ),
      ),
    ),
  );
  const mergedTaskEvents = Stream.mergeAll(taskStreams, { concurrency: tasks.length }).pipe(
    Stream.ensuring(PubSub.shutdown(taskResultPubsub)),
  );

  const benchFields = yield* makeBenchFields(bench);

  const persist = yield* Effect.serviceOption(Event.Persist.Service);

  if (Option.isSome(persist)) {
    const stream = persist.value.getBench(Event.BenchID.make(benchFields));
    if (Option.isSome(stream)) {
      return stream.value.pipe(
        Stream.catchTag("EventError", (error) =>
          Stream.fail(Event.BenchErrorEvent.make({ ...benchFields, error })),
        ),
      );
    }
  }

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
        entries.map(([id, trails]) => [id, Event.TaskResult.make({ trails })] as const),
        Object.fromEntries<Event.TaskResult>,
      ),
    ),
    Effect.flatMap((tasks) => Cause.done(Event.BenchResult.make({ tasks }))),
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
    Stream.catchIf(
      (error) => !Cause.isDone(error),
      (error) =>
        makeBenchFields(bench).pipe(
          Effect.flatMap((fields) => Effect.fail(Event.BenchErrorEvent.make({ ...fields, error }))),
          Stream.fromEffect,
        ),
    ),
  );
}, Stream.unwrap);
