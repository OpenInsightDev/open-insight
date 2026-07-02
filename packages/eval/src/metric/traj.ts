import type { Agent } from "@open-insight/core/internal";
import { type Data, Effect, Match, Schema } from "effect";
import type { Bivariant, UnionToIntersection } from "@/utils/variant.ts";
import { MetricError } from "./error.ts";
import { type Input, TrajOutput } from "./schema.ts";
import type * as _Core from "@open-insight/core";

export type ReduceFn<R> = (
  prev: R,
  input: {
    trajectory: Agent.Trajectory;
    messages: ReadonlyArray<Agent.Message>;
  },
) => PromiseLike<R> | R;

export type EachFn<R> = (input: {
  trajectory: Agent.Trajectory;
  messages: ReadonlyArray<Agent.Message>;
}) => PromiseLike<R> | R;

export type AllFn<R> = (input: { trajectory: Agent.Trajectory }) => PromiseLike<R> | R;

type ReduceExec<R = unknown> = {
  init: R;
  exec: Bivariant<ReduceFn<R>>;
};

type EachExec<R = unknown> = {
  exec: Bivariant<EachFn<R>>;
};

type AllExec<R = unknown> = {
  exec: Bivariant<AllFn<R>>;
};

export type Exec<R = unknown> = Data.TaggedEnum<{
  Reduce: ReduceExec<R>;
  Each: EachExec<R>;
  All: AllExec<R>;
}>;

export type Metric<N extends string = string, R = unknown> = Readonly<{
  name: N;
  exec: Exec<R>;
}>;

export const reduce = <N extends string, R>(name: N, init: R, exec: ReduceFn<R>): Metric<N, R> => ({
  name,
  exec: { _tag: "Reduce", init, exec },
});

export const each = <N extends string, R>(name: N, exec: EachFn<R>): Metric<N, R> => ({
  name,
  exec: { _tag: "Each", exec },
});

export const all = <N extends string, R>(name: N, exec: AllFn<R>): Metric<N, R> => ({
  name,
  exec: { _tag: "All", exec },
});

export type Result<M> = UnionToIntersection<
  M extends Metric<infer N, infer R> ? Record<N, R> : never
>;

const runExec = (name: string, exec: () => PromiseLike<unknown> | unknown) =>
  Effect.tryPromise({
    try: async () => await exec(),
    catch: MetricError.exec({ name, type: "Trajectory" }),
  }).pipe(
    Effect.flatMap((result) =>
      Schema.decodeUnknownEffect(Schema.Json)(result).pipe(
        Effect.mapError(MetricError.trajExec(name)),
      ),
    ),
  );

export const buildReduce = ({ name, exec }: { name: string; exec: ReduceExec }) => {
  const state = { value: exec.init };

  return Effect.fn(function* ({
    task,
    trailIndex,
    trajectory,
    delta,
  }: Input): Effect.fn.Return<TrajOutput | null, MetricError> {
    if (delta._tag !== "Messages") {
      return null;
    }

    const rawResult = yield* Effect.tryPromise({
      try: async () => await exec.exec(state.value, { trajectory, messages: delta.messages }),
      catch: MetricError.trajExec(name),
    });
    const result = yield* Schema.decodeUnknownEffect(Schema.Json)(rawResult).pipe(
      Effect.mapError(MetricError.trajExec(name)),
    );
    state.value = rawResult;

    return TrajOutput.make({
      name,
      task: task,
      trailIndex,
      result,
    });
  });
};

export const buildEach = ({ name, exec }: { name: string; exec: EachExec }) =>
  Effect.fn(function* ({
    task,
    trailIndex,
    trajectory,
    delta,
  }: Input): Effect.fn.Return<TrajOutput | null, MetricError> {
    if (delta._tag !== "Messages") {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec({ trajectory, messages: delta.messages }));

    return TrajOutput.make({
      name,
      task: task,
      trailIndex,
      result,
    });
  });

export const buildAll = ({ name, exec }: { name: string; exec: AllExec }) => {
  return Effect.fn(function* ({
    task,
    trailIndex,
    trajectory,
    delta,
  }: Input): Effect.fn.Return<TrajOutput | null, MetricError> {
    // not the full trajectory, skip this metric
    if (delta._tag !== "Grade") {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec({ trajectory }));

    return TrajOutput.make({
      name,
      task: task,
      trailIndex,
      result,
    });
  });
};

export const build = (metric: Metric) =>
  Match.value(metric.exec).pipe(
    Match.tag("Reduce", (exec) => buildReduce({ name: metric.name, exec })),
    Match.tag("Each", (exec) => buildEach({ name: metric.name, exec })),
    Match.tag("All", (exec) => buildAll({ name: metric.name, exec })),
    Match.exhaustive,
  );
