import { Cause, Effect, FileSystem, Path, Ref, Semaphore, Stream } from "effect";
import * as Bench from "#/bench/index.ts";
import type { Config } from "./config.ts";
import { Harness } from "@open-insight/core";
import * as Event from "#/event/index.ts";
import { BenchResult, TaskResult } from "./result.ts";
import * as Trail from "./trail.ts";
import { Sandbox } from "@open-insight/core/internal";
import { castDraft, produce } from "immer";

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

  const taskResultsRef = yield* Ref.make<Record<string, TaskResult>>({});

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
          Ref.update(
            taskResultsRef,
            produce((results) => {
              results[task.metadata.id] = castDraft(result);
            }),
          ).pipe(() => Stream.empty),
        ),
      )
      .pipe(
        Stream.provideService(Harness.Service, harness),
        Stream.provideService(FileSystem.FileSystem, fs),
        Stream.provideService(Path.Path, path),
        Stream.provideService(Sandbox.ProviderService, sbxProvider),
      ),
  );
  const mergedTaskStream = Stream.mergeAll(taskStreams, { concurrency: tasks.length });

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

  const result = Ref.get(taskResultsRef)
    .pipe(Effect.flatMap((results) => Cause.done(BenchResult.make({ tasks: results }))))
    .pipe(Stream.fromEffect);

  return Stream.empty.pipe(
    Stream.concat(startEvent),
    Stream.concat(mergedTaskStream),
    Stream.concat(endEvent),
    Stream.concat(result),
  );
}, Stream.unwrap);
