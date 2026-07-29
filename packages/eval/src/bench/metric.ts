import { Crypto, Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import * as Grade from "#/grade/index.ts";
import type { Bench } from "./build.ts";
import { Error } from "./error.ts";

type MetricOptions<G extends Grade.Result, R extends Schema.JsonObject> = Omit<
  Metric.Bench.Options<G, R>,
  "exec"
>;
type TaskMetricOptions<G extends Grade.Result, R extends Schema.JsonObject> = Omit<
  Metric.Task.Options<G, R>,
  "exec"
>;
type TrajMetricOptions<R extends Schema.JsonObject> = Omit<Metric.Traj.Options<R>, "exec">;

const makeMetric = <G extends Grade.Result, R extends Schema.JsonObject>(
  options: Metric.Bench.Options<G, R>,
) => Metric.Bench.make(options).pipe(Effect.mapError(Error.init));

const makeTaskMetric = <G extends Grade.Result, R extends Schema.JsonObject>(
  options: Metric.Task.Options<G, R>,
) => Metric.Task.make(options).pipe(Effect.mapError(Error.init));

const makeTrajMetric = <R extends Schema.JsonObject>(options: Metric.Traj.Options<R>) =>
  Metric.Traj.make(options).pipe(Effect.mapError(Error.init));

type MetricBuilder<G extends Grade.Result> = <
  Extras extends object,
  Stage extends Task.Stage,
  E,
  Env,
>(
  bench: Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E, Env>,
) => Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E | Error, Env | Crypto.Crypto>;

type AttachedMetricBuilder = <T extends Task.Task, E, Env>(
  bench: Effect.Effect<Bench<T>, E, Env>,
) => Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto>;

const isTaskExecEffect = <G extends Grade.Result, R extends Schema.JsonObject>(
  input: Metric.Task.ExecEffect<G, R> | Metric.Task.Options<G, R>,
): input is Metric.Task.ExecEffect<G, R> => Effect.isEffect(input);

export function metric<G extends Grade.Result, R extends Schema.JsonObject>(
  exec: Metric.Bench.ExecEffect<G, R>,
  options?: MetricOptions<G, R>,
): MetricBuilder<G>;
export function metric<G extends Grade.Result, R extends Schema.JsonObject>(
  exec: Metric.Bench.Exec<G, R>,
  options?: MetricOptions<G, R>,
): MetricBuilder<G>;
export function metric<G extends Grade.Result, R extends Schema.JsonObject>(
  exec: Metric.Bench.ExecEffect<G, R> | Metric.Bench.Exec<G, R>,
  options: MetricOptions<G, R> = {},
): MetricBuilder<G> {
  return <Extras extends object, Stage extends Task.Stage, E, Env>(
    bench: Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E, Env>,
  ): Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E | Error, Env | Crypto.Crypto> =>
    bench.pipe(
      Effect.flatMap(
        Effect.fn(function* (bench) {
          const execEffect = typeof exec === "function" ? Effect.succeed(exec) : exec;
          const metric = yield* makeMetric({ ...options, exec: yield* execEffect });
          return produce(bench, (draft) => {
            draft.metrics.push(castDraft(metric));
          });
        }),
      ),
    );
}

export function taskMetric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  options: Metric.Task.Options<G, R>,
): MetricBuilder<G>;
export function taskMetric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  exec: Metric.Task.ExecEffect<G, R>,
  options?: TaskMetricOptions<G, R>,
): MetricBuilder<G>;
export function taskMetric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  exec: Metric.Task.Exec<G, R>,
  options?: TaskMetricOptions<G, R>,
): MetricBuilder<G>;
export function taskMetric<G extends Grade.Result, R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  execOrOptions: Metric.Task.ExecEffect<G, R> | Metric.Task.Exec<G, R> | Metric.Task.Options<G, R>,
  options: TaskMetricOptions<G, R> = {},
): MetricBuilder<G> {
  return <Extras extends object, Stage extends Task.Stage, E, Env>(
    bench: Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E, Env>,
  ): Effect.Effect<Bench<Task.Task<G, Extras, Stage>>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      const metricOptions =
        typeof execOrOptions === "function"
          ? Effect.succeed({ ...options, exec: execOrOptions })
          : isTaskExecEffect(execOrOptions)
            ? Effect.map(execOrOptions, (exec) => ({ ...options, exec }))
            : Effect.succeed(execOrOptions);

      return metricOptions.pipe(
        Effect.flatMap(makeTaskMetric),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.metrics.push(castDraft(metric));
                return;
              }
            }
          }),
        ),
      );
    });
}

export function trajMetric<R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  options: Metric.Traj.Options<R>,
): AttachedMetricBuilder;
export function trajMetric<R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  exec: Metric.Traj.Exec<R>,
  options?: TrajMetricOptions<R>,
): AttachedMetricBuilder;
export function trajMetric<R extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  execOrOptions: Metric.Traj.Exec<R> | Metric.Traj.Options<R>,
  options: TrajMetricOptions<R> = {},
): AttachedMetricBuilder {
  return <T extends Task.Task, E, Env>(
    bench: Effect.Effect<Bench<T>, E, Env>,
  ): Effect.Effect<Bench<T>, E | Error, Env | Crypto.Crypto> =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      const metricOptions =
        typeof execOrOptions === "function"
          ? Effect.succeed({ ...options, exec: execOrOptions })
          : Effect.succeed(execOrOptions);

      return metricOptions.pipe(
        Effect.flatMap(makeTrajMetric),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.trajMetrics.push(castDraft(metric));
                return;
              }
            }
          }),
        ),
      );
    });
}
