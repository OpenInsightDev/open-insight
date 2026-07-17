import { Cause, Effect, pipe, Queue, Scope, Stream } from "effect";
import * as TaskMetric from "./task/index.ts";
import * as BenchMetric from "./bench/index.ts";
import * as TrajMetric from "./traj/index.ts";
import type { BenchOutput, Input, Output, TaskOutput, TrajOutput } from "./schema.ts";
import type { Error } from "./error.ts";
import type { Metrics } from "./build.ts";
import type * as _Core from "@open-insight/core";

type InputStream<E, R> = Stream.Stream<Input, E, R>;
type OutputQueue<E = never> = Queue.Queue<Output, E | Error | Cause.Done>;
type OutputStream<E = never> = Stream.Stream<Output, E | Error>;

export const buildTrajMetricConsumer = <E = never>({
  metrics: metricVariants,
  queue,
}: {
  metrics: ReadonlyArray<TrajMetric.Metric>;
  queue: OutputQueue<E>;
}) => {
  const metrics = metricVariants.map(TrajMetric.build);

  return Effect.fn(function* (input: Input): Effect.fn.Return<Array<TrajOutput> | null, Error> {
    const exec = Effect.fn(function* (output: TrajOutput | null) {
      if (output === null) {
        return null;
      }
      yield* Queue.offer(queue, output);
      return output;
    });

    const outputs = yield* Effect.forEach(
      metrics,
      (metric) => metric(input).pipe(Effect.flatMap(exec)),
      { concurrency: "unbounded" },
    );

    if (outputs.every((output): output is TrajOutput => output !== null)) {
      return outputs;
    }

    return null;
  });
};

export const buildTaskMetricConsumer = <E = never>({
  metrics: metricVariants,
  trailCount,
  queue,
}: {
  metrics: ReadonlyArray<TaskMetric.Metric>;
  trailCount: number;
  queue: OutputQueue<E>;
}) => {
  const metrics = metricVariants.map((metric) => TaskMetric.build({ metric, trailCount }));

  return Effect.fn(function* (input: Input) {
    const exec = Effect.fn(function* (output: TaskOutput | null) {
      if (output === null) {
        return null;
      }
      yield* Queue.offer(queue, output);
      return output;
    });

    const outputs = yield* Effect.forEach(
      metrics,
      (metric) => metric(input).pipe(Effect.flatMap(exec)),
      { concurrency: "unbounded" },
    );

    if (outputs.every((output): output is TaskOutput => output !== null)) {
      return outputs;
    }

    return null;
  });
};

export const buildBenchMetricConsumer = <E = never>({
  metrics: metricVariants,
  taskCount,
  queue,
}: {
  metrics: ReadonlyArray<BenchMetric.Metric>;
  taskCount: number;
  queue: OutputQueue<E>;
}) => {
  const metrics = metricVariants.map((metric) => BenchMetric.build({ metric, taskCount }));

  return Effect.fn(function* (input: BenchMetric.Input) {
    const exec = Effect.fn(function* (output: BenchOutput | null) {
      if (output === null) {
        return null;
      }
      yield* Queue.offer(queue, output);
      return output;
    });

    const outputs = yield* Effect.forEach(
      metrics,
      (metric) => metric(input).pipe(Effect.flatMap(exec)),
      { concurrency: "unbounded" },
    );

    if (outputs.every((output): output is BenchOutput => output !== null)) {
      return outputs;
    }

    return null;
  });
};

export const transform = ({
  metrics,
  trailCount,
  taskCount,
}: {
  metrics: Metrics;
  trailCount: number;
  taskCount: number;
}) =>
  Effect.fn(
    function* <E, R>(
      inputStream: InputStream<E, R>,
    ): Effect.fn.Return<OutputStream<E>, E | Error, R | Scope.Scope> {
      const outputQueue = yield* Queue.bounded<Output, E | Error | Cause.Done>(128);

      const consumeTrajMetrics = buildTrajMetricConsumer({
        metrics: metrics.trajectory,
        queue: outputQueue,
      });
      const consumeTaskMetrics = buildTaskMetricConsumer({
        metrics: metrics.task,
        trailCount,
        queue: outputQueue,
      });
      const consumeBenchMetrics = buildBenchMetricConsumer({
        metrics: metrics.benchmark,
        taskCount,
        queue: outputQueue,
      });

      const mapTaskMetrics = Effect.fn(function* (
        input: Input,
      ): Effect.fn.Return<BenchMetric.Input | null, Error> {
        const taskOutputs = yield* consumeTaskMetrics(input);
        if (taskOutputs === null) {
          return null;
        }
        return {
          task: input.task.name,
          input: pipe(
            taskOutputs.map(({ name, result }) => [name, result] as const),
            Object.fromEntries,
          ),
        } satisfies BenchMetric.Input;
      });

      const gradeStream = inputStream
        .pipe(Stream.tap(consumeTrajMetrics, { concurrency: "unbounded" }))
        .pipe(Stream.filter((input) => input.delta._tag === "Grade"));

      const benchInputStream = gradeStream.pipe(
        Stream.mapEffect(mapTaskMetrics, { concurrency: "unbounded", unordered: true }),
        Stream.filter((input) => input !== null),
      );

      const run = benchInputStream.pipe(
        Stream.tap(consumeBenchMetrics, { concurrency: "unbounded" }),
        Stream.runDrain,
      );

      yield* run.pipe(Queue.into(outputQueue)).pipe(Effect.forkScoped);

      return Stream.fromQueue(outputQueue);
    },
    (effect) => effect.pipe(Stream.unwrap),
  );
