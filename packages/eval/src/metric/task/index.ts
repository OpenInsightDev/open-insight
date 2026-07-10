import { type Data, Effect, Match, Schema } from "effect";
import type * as Grade from "#/grade/index.ts";
import type { Bivariant, UnionToIntersection } from "#/utils/variant.ts";
import { MetricError } from "../error.ts";
import { type Input, TaskOutput } from "../schema.ts";
import type * as _Core from "@open-insight/core";

export type ReduceFn<G extends Grade.Result, R> = (prev: R, input: G) => PromiseLike<R> | R;

export type EachFn<G extends Grade.Result, R> = (input: G) => PromiseLike<R> | R;

export type AllFn<G extends Grade.Result, R> = (input: ReadonlyArray<G>) => PromiseLike<R> | R;

type ReduceExec<G extends Grade.Result = Grade.Result, R = unknown> = {
  init: R;
  exec: Bivariant<ReduceFn<G, R>>;
};

type EachExec<G extends Grade.Result = Grade.Result, R = unknown> = {
  exec: Bivariant<EachFn<G, R>>;
};

type AllExec<G extends Grade.Result = Grade.Result, R = unknown> = {
  exec: Bivariant<AllFn<G, R>>;
};

export type Exec<G extends Grade.Result = Grade.Result, R = unknown> = Data.TaggedEnum<{
  Reduce: ReduceExec<G, R>;
  Each: EachExec<G, R>;
  All: AllExec<G, R>;
}>;
export type ExecTag = Exec["_tag"];

export type Metric<
  N extends string = string, // metric name
  R = unknown, // metric result
  T extends ExecTag = ExecTag, // exec type
  G extends Grade.Result = Grade.Result, // grade result
> = Readonly<{
  name: N;
  exec: Exec<G, R>;
}> & { _N?: N; _R?: R; _T?: T; _G?: G };

const makeReduce = <G extends Grade.Result, R>(exec: ReduceExec<G, R>): Exec<G, R> => ({
  _tag: "Reduce",
  ...exec,
});

const makeEach = <G extends Grade.Result, R>(exec: EachExec<G, R>): Exec<G, R> => ({
  _tag: "Each",
  ...exec,
});

const makeAll = <G extends Grade.Result, R>(exec: AllExec<G, R>): Exec<G, R> => ({
  _tag: "All",
  ...exec,
});

export const reduce = <G extends Grade.Result, N extends string, R>(
  name: N,
  init: R,
  exec: ReduceFn<G, R>,
): Metric<N, R, "Reduce", G> => ({
  name,
  exec: makeReduce({ init, exec }),
});

export const each = <G extends Grade.Result, N extends string, R>(
  name: N,
  exec: EachFn<G, R>,
): Metric<N, R, "Each", G> => ({
  name,
  exec: makeEach({ exec }),
});

export const all = <G extends Grade.Result, N extends string, R>(
  name: N,
  exec: AllFn<G, R>,
): Metric<N, R, "All", G> => ({
  name,
  exec: makeAll({ exec }),
});

export type Result<M> = UnionToIntersection<
  M extends Metric<infer N extends string, infer R, infer _T, infer _G> ? { [K in N]: R } : never
>;
export type StreamResult<M> = UnionToIntersection<
  M extends Metric<infer N extends string, infer R, infer T, infer _G>
    ? // `All` metrics are not available when streaming
      Omit<{ [K in N]: R }, T extends "All" ? N : never>
    : never
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
      result: result,
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
      result: result,
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
  const taskMap = new Map<string, Array<Grade.Result>>();

  return Effect.fn(function* ({
    task,
    delta,
  }: Input): Effect.fn.Return<TaskOutput | null, MetricError> {
    if (delta._tag !== "Grade") {
      return null;
    }

    const inputs = taskMap.getOrInsert(task.name, []);

    inputs.push(delta.result);
    if (inputs.length < trailCount) {
      return null;
    }

    const result = yield* runExec(name, () => exec.exec(inputs));

    return TaskOutput.make({
      name,
      task: task.metadata,
      result: result,
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
