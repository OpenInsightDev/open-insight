import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Task } from "./build.ts";
import { Error } from "./error.ts";
import type { Stage } from "./stage.ts";

type TaskMetricOptions<G extends Grade.Result, R extends Schema.JsonObject> = Omit<
  Metric.Task.Options<G, R>,
  "exec"
>;

type TrajMetricOptions<R extends Schema.JsonObject> = Omit<Metric.Traj.Options<R>, "exec">;

const makeMetric = <G extends Grade.Result, R extends Schema.JsonObject>(
  options: Metric.Task.Options<G, R>,
) => Metric.Task.make(options).pipe(Effect.mapError(Error.metadata));

const makeTrajMetric = <R extends Schema.JsonObject>(options: Metric.Traj.Options<R>) =>
  Metric.Traj.make(options).pipe(Effect.mapError(Error.metadata));

type TaskMetricBuilder<G extends Grade.Result> = <Ex extends object, S extends Stage, E, Env>(
  task: Effect.Effect<Task<G, Ex, S>, E, Env>,
) => Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto>;

type TrajMetricBuilder = <G extends Grade.Result, Ex extends object, S extends Stage, E, Env>(
  task: Effect.Effect<Task<G, Ex, S>, E, Env>,
) => Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto>;

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
  return <Ex extends object, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const execEffect = typeof exec === "function" ? Effect.succeed(exec) : exec;
          const metric = yield* makeMetric({ ...options, exec: yield* execEffect });
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
  return <G extends Grade.Result, Ex extends object, S extends Stage, E, Env>(
    task: Effect.Effect<Task<G, Ex, S>, E, Env>,
  ): Effect.Effect<Task<G, Ex, S>, E | Error, Env | Crypto.Crypto> =>
    task.pipe(
      Effect.flatMap(
        Effect.fn(function* (task) {
          const metric = yield* makeTrajMetric({ ...options, exec });
          return produce(task, (draft) => {
            draft.trajMetrics.push(castDraft(metric));
          });
        }),
      ),
    );
}
