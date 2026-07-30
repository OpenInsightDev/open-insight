import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Task } from "./build.ts";
import { Error } from "./error.ts";
import type * as Template from "./template.ts";

type TaskMetricOptions<G extends Grade.Result, M extends Schema.JsonObject> = Omit<
  Metric.Task.Options<G, M>,
  "exec"
>;

type TrajMetricOptions<M extends Schema.JsonObject> = Omit<Metric.Traj.Options<M>, "exec">;

type TaskMetric<
  /** Grade result. */
  G extends Grade.Result,
> = <
  /** Task extras. */
  X extends object,
  /** Task template. */
  T extends Template.Unknown,
  /** Effect error. */
  E,
  /** Effect requirements. */
  R,
>(
  task: Effect.Effect<Task<G, X, T>, E, R>,
) => Effect.Effect<Task<G, X, T>, E | Error, R | Crypto.Crypto>;

type TrajMetric = <
  /** Grade result. */
  G extends Grade.Result,
  /** Task extras. */
  X extends object,
  /** Task template. */
  T extends Template.Unknown,
  /** Effect error. */
  E,
  /** Effect requirements. */
  R,
>(
  task: Effect.Effect<Task<G, X, T>, E, R>,
) => Effect.Effect<Task<G, X, T>, E | Error, R | Crypto.Crypto>;

export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, M>,
  options?: TaskMetricOptions<G, M>,
): TaskMetric<G>;
export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.Exec<G, M>,
  options?: TaskMetricOptions<G, M>,
): TaskMetric<G>;
export function metric<G extends Grade.Result, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Task.ExecEffect<G, M> | Metric.Task.Exec<G, M>,
  options: TaskMetricOptions<G, M> = {},
): TaskMetric<G> {
  return <X extends object, T extends Template.Unknown, E, R>(
    task: Effect.Effect<Task<G, X, T>, E, R>,
  ): Effect.Effect<Task<G, X, T>, E | Error, R | Crypto.Crypto> =>
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
): TrajMetric;
export function trajMetric<M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Traj.Exec<M>,
  options: TrajMetricOptions<M> = {},
): TrajMetric {
  return <G extends Grade.Result, X extends object, T extends Template.Unknown, E, R>(
    task: Effect.Effect<Task<G, X, T>, E, R>,
  ): Effect.Effect<Task<G, X, T>, E | Error, R | Crypto.Crypto> =>
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
