import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Effect, Schema } from "effect";
import { produce } from "immer";

export const Empty = Schema.Struct({});
export type Empty = Schema.Schema.Type<typeof Empty>;

export type Template<G extends Grade.AnyResult, E extends Schema.Constraint> = Readonly<{
  grade: G;
  extra: E;

  taskMetrics: ReadonlyArray<Metric.Task.Metric<G>>;
  trajMetrics: ReadonlyArray<Metric.Traj.Metric>;
  schedMetrics: ReadonlyArray<Metric.Sched.Metric>;
}>;

export function make<G extends Grade.AnyResult>(grade: G): Effect.Effect<Template<G, typeof Empty>>;
export function make<G extends Grade.AnyResult, E extends Schema.Constraint>(
  grade: G,
  extra: E,
): Effect.Effect<Template<G, E>>;
export function make<G extends Grade.AnyResult, E extends Schema.Constraint>(
  grade: G,
  extra?: E,
): Effect.Effect<Template<G, E>> {
  return Effect.succeed({
    grade,
    extra: extra ?? ({} as E),
    taskMetrics: [],
    trajMetrics: [],
    schedMetrics: [],
  });
}

class GradeResult extends Schema.Class<GradeResult>("GradeResult")({
  pass: Schema.Boolean,
}) {}

export const trajMetric =
  <R extends Schema.Json = any>(metric: Metric.Traj.Metric<R>) =>
  <G extends Grade.AnyResult, Ex extends Schema.Constraint, E, R>(
    template: Effect.Effect<Template<G, Ex>, E, R>,
  ): Effect.Effect<Template<G, Ex>, E | Error, R> =>
    Effect.flatMap(template, (template) =>
      Effect.succeed(
        produce(template, (draft) => {
          draft.trajMetrics.push(metric);
        }),
      ),
    );

export const schedMetric =
  <R extends Schema.Json = any>(metric: Metric.Sched.Metric<R>) =>
  <G extends Grade.AnyResult, Ex extends Schema.Constraint, E, R>(
    template: Effect.Effect<Template<G, Ex>, E, R>,
  ): Effect.Effect<Template<G, Ex>, E | Error, R> =>
    Effect.flatMap(template, (template) =>
      Effect.succeed(
        produce(template, (draft) => {
          draft.schedMetrics.push(metric);
        }),
      ),
    );

export const taskMetric =
  <G extends Grade.AnyResult, R extends Schema.Json = any>(metric: Metric.Task.Metric<G, R>) =>
  <Ex extends Schema.Constraint, E, R>(
    template: Effect.Effect<Template<G, Ex>, E, R>,
  ): Effect.Effect<Template<G, Ex>, E | Error, R> =>
    Effect.flatMap(template, (template) =>
      Effect.succeed(
        produce(template, (draft) => {
          draft.taskMetrics.push(metric);
        }),
      ),
    );
