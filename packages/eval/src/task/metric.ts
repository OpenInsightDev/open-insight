import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Builder } from "./build.ts";
import { Error } from "./error.ts";
import type * as Template from "./template.ts";

type TaskMetricOptions<G extends Grade.Result, R extends Schema.JsonObject> = Omit<
  Metric.Task.Options<G, R>,
  "exec"
>;

type TrajMetricOptions<R extends Schema.JsonObject> = Omit<Metric.Traj.Options<R>, "exec">;

type TaskMetricBuilder<G extends Grade.Result> = <
  Ex extends object,
  S extends Grade.Results,
  T extends Template.Unknown,
  E,
  Env,
>(
  task: Effect.Effect<Builder<G, Ex, S, T>, E, Env>,
) => Effect.Effect<Builder<G, Ex, S, T>, E | Error, Env | Crypto.Crypto>;

type TrajMetricBuilder = <
  G extends Grade.Result,
  Ex extends object,
  S extends Grade.Results,
  T extends Template.Unknown,
  E,
  Env,
>(
  task: Effect.Effect<Builder<G, Ex, S, T>, E, Env>,
) => Effect.Effect<Builder<G, Ex, S, T>, E | Error, Env | Crypto.Crypto>;

export function metric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, R>,
  options?: TaskMetricOptions<G, R>,
): TaskMetricBuilder<G>;
export function metric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.Exec<G, R>,
  options?: TaskMetricOptions<G, R>,
): TaskMetricBuilder<G>;
export function metric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, R> | Metric.Task.Exec<G, R>,
  options: TaskMetricOptions<G, R> = {},
): TaskMetricBuilder<G> {
  return <Ex extends object, S extends Grade.Results, T extends Template.Unknown, E, Env>(
    task: Effect.Effect<Builder<G, Ex, S, T>, E, Env>,
  ): Effect.Effect<Builder<G, Ex, S, T>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* Metric.Task.make({
            ...options,
            exec: yield* typeof exec === "function" ? Effect.succeed(exec) : exec,
          }).pipe(Effect.mapError(Error.metadata));
          return produce(task, (draft) => {
            draft.metrics.push(castDraft(metric));
          });
        }),
      ),
    );
}

export function trajMetric<R extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Traj.Exec<R>,
  options?: TrajMetricOptions<R>,
): TrajMetricBuilder;
export function trajMetric<R extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Traj.Exec<R>,
  options: TrajMetricOptions<R> = {},
): TrajMetricBuilder {
  return <
    G extends Grade.Result,
    Ex extends object,
    S extends Grade.Results,
    T extends Template.Unknown,
    E,
    Env,
  >(
    task: Effect.Effect<Builder<G, Ex, S, T>, E, Env>,
  ): Effect.Effect<Builder<G, Ex, S, T>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* Metric.Traj.make({ ...options, exec }).pipe(
            Effect.mapError(Error.metadata),
          );
          return produce(task, (draft) => {
            draft.trajMetrics.push(castDraft(metric));
          });
        }),
      ),
    );
}
