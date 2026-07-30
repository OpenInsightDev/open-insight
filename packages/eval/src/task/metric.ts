import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Builder } from "./build.ts";
import { Error } from "./error.ts";
import type * as Template from "./template.ts";

type TaskMetricOptions<G extends Grade.Result, M extends Schema.JsonObject> = Omit<
  Metric.Task.Options<G, M>,
  "exec"
>;

type TrajMetricOptions<M extends Schema.JsonObject> = Omit<Metric.Traj.Options<M>, "exec">;

type TaskMetricBuilder<
  /** Grade result. */
  G extends Grade.Result,
> = <
  /** Task extras. */
  X extends object,
  /** Stage results. */
  S extends Grade.Results,
  /** Task template. */
  T extends Template.Unknown,
  /** Effect error. */
  E,
  /** Effect requirements. */
  R,
>(
  task: Effect.Effect<Builder<G, X, S, T>, E, R>,
) => Effect.Effect<Builder<G, X, S, T>, E | Error, R | Crypto.Crypto>;

type TrajMetricBuilder = <
  /** Grade result. */
  G extends Grade.Result,
  /** Task extras. */
  X extends object,
  /** Stage results. */
  S extends Grade.Results,
  /** Task template. */
  T extends Template.Unknown,
  /** Effect error. */
  E,
  /** Effect requirements. */
  R,
>(
  task: Effect.Effect<Builder<G, X, S, T>, E, R>,
) => Effect.Effect<Builder<G, X, S, T>, E | Error, R | Crypto.Crypto>;

export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, M>,
  options?: TaskMetricOptions<G, M>,
): TaskMetricBuilder<G>;
export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.Exec<G, M>,
  options?: TaskMetricOptions<G, M>,
): TaskMetricBuilder<G>;
export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, M> | Metric.Task.Exec<G, M>,
  options: TaskMetricOptions<G, M> = {},
): TaskMetricBuilder<G> {
  return <X extends object, S extends Grade.Results, T extends Template.Unknown, E, R>(
    task: Effect.Effect<Builder<G, X, S, T>, E, R>,
  ): Effect.Effect<Builder<G, X, S, T>, E | Error, R | Crypto.Crypto> =>
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

export function trajMetric<M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Traj.Exec<M>,
  options?: TrajMetricOptions<M>,
): TrajMetricBuilder;
export function trajMetric<M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Traj.Exec<M>,
  options: TrajMetricOptions<M> = {},
): TrajMetricBuilder {
  return <
    G extends Grade.Result,
    X extends object,
    S extends Grade.Results,
    T extends Template.Unknown,
    E,
    R,
  >(
    task: Effect.Effect<Builder<G, X, S, T>, E, R>,
  ): Effect.Effect<Builder<G, X, S, T>, E | Error, R | Crypto.Crypto> =>
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
