import { type Data, Effect, Match, Schema } from "effect";
import type { Bivariant, UnionToIntersection } from "@/utils/variant.ts";
import { MetricError } from "./error.ts";
import { BenchOutput } from "./schema.ts";
import type * as TaskMetric from "./task.ts";

export type Input<TAM extends TaskMetric.Metric = TaskMetric.Metric> = {
  task: string;
  input: TaskMetric.Result<TAM>;
};

export type Inputs<TAM extends TaskMetric.Metric = TaskMetric.Metric> = Record<
  /* task ID */ string,
  TaskMetric.Result<TAM>
>;

export type ReduceFn<TAM extends TaskMetric.Metric, R> = (
  prev: R,
  input: Input<TAM>,
) => PromiseLike<R> | R;

export type EachFn<TAM extends TaskMetric.Metric, R> = (input: Input<TAM>) => PromiseLike<R> | R;

export type AllFn<TAM extends TaskMetric.Metric, R> = (input: Inputs<TAM>) => PromiseLike<R> | R;

type ReduceExec<TAM extends TaskMetric.Metric = TaskMetric.Metric, R = unknown> = {
  init: R;
  exec: Bivariant<ReduceFn<TAM, R>>;
};

type EachExec<TAM extends TaskMetric.Metric = TaskMetric.Metric, R = unknown> = {
  exec: Bivariant<EachFn<TAM, R>>;
};

type AllExec<TAM extends TaskMetric.Metric = TaskMetric.Metric, R = unknown> = {
  exec: Bivariant<AllFn<TAM, R>>;
};

export type Exec<TAM extends TaskMetric.Metric = TaskMetric.Metric, R = unknown> = Data.TaggedEnum<{
  Reduce: ReduceExec<TAM, R>;
  Each: EachExec<TAM, R>;
  All: AllExec<TAM, R>;
}>;

export type Metric<
  TAM extends TaskMetric.Metric = TaskMetric.Metric,
  N extends string = string,
  R = unknown,
> = Readonly<{ name: N; exec: Exec<TAM, R> }>;

export const reduce = <TAM extends TaskMetric.Metric, N extends string, R>(
  name: N,
  init: R,
  exec: ReduceFn<TAM, R>,
): Metric<TAM, N, R> => ({
  name,
  exec: { _tag: "Reduce", init, exec },
});

export const each = <TAM extends TaskMetric.Metric, N extends string, R>(
  name: N,
  exec: EachFn<TAM, R>,
): Metric<TAM, N, R> => ({
  name,
  exec: { _tag: "Each", exec },
});

export const all = <TAM extends TaskMetric.Metric, N extends string, R>(
  name: N,
  exec: AllFn<TAM, R>,
): Metric<TAM, N, R> => ({
  name,
  exec: { _tag: "All", exec },
});

export type Result<M> = UnionToIntersection<
  M extends Metric<infer _, infer N, infer R> ? Record<N, R> : never
>;

const runExec = (name: string, exec: () => PromiseLike<unknown> | unknown) =>
  Effect.tryPromise({
    try: async () => await exec(),
    catch: MetricError.exec({ name, type: "Benchmark" }),
  }).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(Schema.Json)(result).pipe(
        Effect.mapError(MetricError.exec({ name, type: "Benchmark" })),
      ),
    ),
  );

export const buildReduce = ({ name, exec }: { name: string; exec: ReduceExec }) => {
  const state = { value: exec.init };

  return Effect.fn(function* (input: Input): Effect.fn.Return<BenchOutput, MetricError> {
    const rawResult = yield* Effect.tryPromise({
      try: async () => await exec.exec(state.value, input),
      catch: MetricError.exec({ name, type: "Benchmark" }),
    });
    const result = yield* Schema.decodeUnknownEffect(Schema.Json)(rawResult).pipe(
      Effect.mapError(MetricError.exec({ name, type: "Benchmark" })),
    );
    state.value = rawResult;

    return BenchOutput.make({
      name,
      result: { [input.task]: result },
    });
  });
};

export const buildEach = ({ name, exec }: { name: string; exec: EachExec }) =>
  Effect.fn(function* (input: Input): Effect.fn.Return<BenchOutput, MetricError> {
    const result = yield* runExec(name, () => exec.exec(input));

    return BenchOutput.make({
      name,
      result: { [input.task]: result },
    });
  });

export const buildAll = ({
  name,
  exec,
  taskCount,
}: {
  name: string;
  exec: AllExec;
  taskCount: number;
}) => {
  const inputs: Inputs = {};

  return Effect.fn(function* (input: Input): Effect.fn.Return<BenchOutput | null, MetricError> {
    if (Object.keys(inputs).length >= taskCount) {
      return null;
    }

    inputs[input.task] = input.input;
    if (Object.keys(inputs).length < taskCount) {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec(inputs));

    return BenchOutput.make({
      name,
      result,
    });
  });
};

export const build = ({ metric, taskCount }: { metric: Metric; taskCount: number }) =>
  Match.value(metric.exec).pipe(
    Match.tag("Reduce", (exec) => buildReduce({ name: metric.name, exec })),
    Match.tag("Each", (exec) => buildEach({ name: metric.name, exec })),
    Match.tag("All", (exec) => buildAll({ name: metric.name, exec, taskCount })),
    Match.exhaustive,
  );
