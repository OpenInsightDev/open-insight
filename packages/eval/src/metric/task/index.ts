import { type Data, Effect, Match, Schema } from "effect";
import type * as Task from "#/task/index.ts";
import type { Bivariant, UnionToIntersection } from "#/utils/variant.ts";
import { MetricError } from "../error.ts";
import { type Input, TaskOutput } from "../schema.ts";
import type * as _Core from "@open-insight/core";

export type ReduceFn<G extends Task.Grade.Result, R> = (prev: R, input: G) => PromiseLike<R> | R;

export type EachFn<G extends Task.Grade.Result, R> = (input: G) => PromiseLike<R> | R;

export type AllFn<G extends Task.Grade.Result, R> = (input: ReadonlyArray<G>) => PromiseLike<R> | R;

type ReduceExec<G extends Task.Grade.Result = Task.Grade.Result, R = unknown> = {
  init: R;
  exec: Bivariant<ReduceFn<G, R>>;
};

type EachExec<G extends Task.Grade.Result = Task.Grade.Result, R = unknown> = {
  exec: Bivariant<EachFn<G, R>>;
};

type AllExec<G extends Task.Grade.Result = Task.Grade.Result, R = unknown> = {
  exec: Bivariant<AllFn<G, R>>;
};

export type Exec<G extends Task.Grade.Result = Task.Grade.Result, R = unknown> = Data.TaggedEnum<{
  Reduce: ReduceExec<G, R>;
  Each: EachExec<G, R>;
  All: AllExec<G, R>;
}>;

export type Metric<
  G extends Task.Grade.Result = Task.Grade.Result,
  N extends string = string,
  R = unknown,
> = Readonly<{ name: N; exec: Exec<G, R> }>;

export const reduce = <G extends Task.Grade.Result, N extends string, R>(
  name: N,
  init: R,
  exec: ReduceFn<G, R>,
): Metric<G, N, R> => ({
  name,
  exec: { _tag: "Reduce", init, exec },
});

export const each = <G extends Task.Grade.Result, N extends string, R>(
  name: N,
  exec: EachFn<G, R>,
): Metric<G, N, R> => ({
  name,
  exec: { _tag: "Each", exec },
});

export const all = <G extends Task.Grade.Result, N extends string, R>(
  name: N,
  exec: AllFn<G, R>,
): Metric<G, N, R> => ({
  name,
  exec: { _tag: "All", exec },
});

export type Result<M> = UnionToIntersection<
  M extends Metric<infer _, infer N, infer R> ? Record<N, R> : never
>;

const runExec = (name: string, exec: () => unknown) =>
  Effect.tryPromise({
    try: async () => await exec(),
    catch: MetricError.exec({ name, type: "Task" }),
  }).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(Schema.Json)(result).pipe(
        Effect.mapError(MetricError.taskExec(name)),
      ),
    ),
  );

export const buildReduce = ({ name, exec }: { name: string; exec: ReduceExec }) => {
  const state = { value: exec.init };

  return Effect.fn(function* ({
    task,
    delta,
  }: Input): Effect.fn.Return<TaskOutput | null, MetricError> {
    if (delta._tag !== "Grade") {
      return null;
    }

    const rawResult = yield* Effect.tryPromise({
      try: async () => await exec.exec(state.value, delta.result),
      catch: MetricError.taskExec(name),
    });
    const result = yield* Schema.decodeUnknownEffect(Schema.Json)(rawResult).pipe(
      Effect.mapError(MetricError.taskExec(name)),
    );
    state.value = rawResult;

    return TaskOutput.make({
      name,
      task: task.metadata,
      result: [result],
    });
  });
};

export const buildEach = ({ name, exec }: { name: string; exec: EachExec }) =>
  Effect.fn(function* ({ task, delta }: Input): Effect.fn.Return<TaskOutput | null, MetricError> {
    if (delta._tag !== "Grade") {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec(delta.result));

    return TaskOutput.make({
      name,
      task: task.metadata,
      result: [result],
    });
  });

export const buildAll = ({
  name,
  exec,
  trailCount,
}: {
  name: string;
  exec: AllExec;
  trailCount: number;
}) => {
  const inputs: Array<Task.Grade.Result> = [];

  return Effect.fn(function* ({
    task,
    delta,
  }: Input): Effect.fn.Return<TaskOutput | null, MetricError> {
    if (delta._tag !== "Grade" || inputs.length >= trailCount) {
      return null;
    }

    inputs.push(delta.result);
    if (inputs.length < trailCount) {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec(inputs));

    return TaskOutput.make({
      name,
      task: task.metadata,
      result: [result],
    });
  });
};

export const build = ({ metric, trailCount }: { metric: Metric; trailCount: number }) =>
  Match.value(metric.exec).pipe(
    Match.tag("Reduce", (exec) => buildReduce({ name: metric.name, exec })),
    Match.tag("Each", (exec) => buildEach({ name: metric.name, exec })),
    Match.tag("All", (exec) => buildAll({ name: metric.name, exec, trailCount })),
    Match.exhaustive,
  );
