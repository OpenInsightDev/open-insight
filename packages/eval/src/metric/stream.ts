import { Cause, Effect, pipe, Queue, Scope, Stream } from "effect";
import * as TaskMetric from "./task/index.ts";
import * as BenchMetric from "./bench/index.ts";
import * as TrajMetric from "./traj/index.ts";
import type { BenchOutput, Input, Output, TaskOutput, TrajOutput } from "./schema.ts";
import type { MetricError } from "./error.ts";
import type { Metrics } from "./build.ts";
import type * as _Core from "@open-insight/core";

type InputStream<E, R> = Stream.Stream<Input, E, R>;
type OutputQueue<E = never> = Queue.Queue<Output, E | MetricError | Cause.Done>;
type OutputStream<E = never> = Stream.Stream<Output, E | MetricError>;

export const buildTrajMetricConsumer = <E = never>({
  metrics: metricVariants,
  queue,
}: {
  metrics: ReadonlyArray<TrajMetric.Metric>;
  queue: OutputQueue<E>;
}) => {
  const metrics = metricVariants.map(TrajMetric.build);

  return Effect.fn(function* (
    input: Input,
  ): Effect.fn.Return<Array<TrajOutput> | null, MetricError> {
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
    ): Effect.fn.Return<OutputStream<E>, E | MetricError, R | Scope.Scope> {
      const gradeQueue = yield* Queue.bounded<Input, MetricError | Cause.Done>(128);
      const benchQueue = yield* Queue.bounded<BenchMetric.Input, MetricError | Cause.Done>(128);
      const outputQueue = yield* Queue.bounded<Output, E | MetricError | Cause.Done>(128);

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

      const tapGradeQueue = Effect.fn(function* (input: Input) {
        if (input.delta._tag !== "Grade") {
          return;
        }
        yield* Queue.offer(gradeQueue, input);
      });

      const tapTaskMetrics = Effect.fn(function* (input: Input) {
        const taskOutputs = yield* consumeTaskMetrics(input);
        if (taskOutputs === null) {
          return;
        }
        yield* Queue.offer(benchQueue, {
          task: input.task.name,
          input: pipe(
            taskOutputs.map(({ name, result }) => [name, result] as const),
            Object.fromEntries,
          ),
        });
      });

      const trajRun = inputStream
        .pipe(Stream.tap(consumeTrajMetrics, { concurrency: "unbounded" }))
        .pipe(Stream.tap(tapGradeQueue, { concurrency: "unbounded" }))
        .pipe(Stream.ensuring(Queue.end(gradeQueue)))
        .pipe(Stream.runDrain);

      const taskRun = Stream.fromQueue(gradeQueue)
        .pipe(Stream.tap(tapTaskMetrics, { concurrency: "unbounded" }))
        .pipe(Stream.ensuring(Queue.end(benchQueue)))
        .pipe(Stream.runDrain);

      const benchRun = Stream.fromQueue(benchQueue)
        .pipe(Stream.tap(consumeBenchMetrics, { concurrency: "unbounded" }))
        .pipe(Stream.runDrain);

      yield* Effect.all([trajRun, taskRun, benchRun], { concurrency: "unbounded" })
        .pipe(Queue.into(outputQueue))
        .pipe(Effect.forkScoped);

      return Stream.fromQueue(outputQueue);
    },
    (effect) => effect.pipe(Stream.unwrap),
  );
