import type { TrailResult } from "#/eval/result.ts";
import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import type * as Task from "#/task/index.ts";
import type { Invariant } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Bench } from "./build.ts";
import { Error } from "./error.ts";

type MetricOptions<R extends Schema.JsonObject> = Omit<Metric.Bench.Options<unknown, R>, "exec">;
type TaskMetricOptions<R extends Schema.JsonObject> = Omit<Metric.Task.Options<unknown, R>, "exec">;
type TrajMetricOptions<R extends Schema.JsonObject> = Omit<Metric.Traj.Options<R>, "exec">;

type GradeSchema<G> = Grade.Result & Readonly<{ Type: G }>;

type TaskWithGrade<G, Schema extends GradeSchema<G>, S extends Task.Stage> = Omit<
  Task.Task<Schema, S>,
  "_G"
> &
  Readonly<{ _G?: Invariant<G> }>;

type MetricBuilder<G> = <Schema extends GradeSchema<G>, S extends Task.Stage, E, R>(
  bench: Effect.Effect<Bench<TaskWithGrade<G, Schema, S>>, E, R>,
) => Effect.Effect<Bench<Task.Task<Schema, S>>, E | Error, R>;

type AttachedMetricBuilder = <T extends Task.AnyTask, E, R>(
  bench: Effect.Effect<Bench<T>, E, R>,
) => Effect.Effect<Bench<T>, E | Error, R>;

const mapTrail = <Input, Mapped>(
  mapper: (grade: Input) => Mapped,
  trail: TrailResult<Input>,
): TrailResult<Mapped> => ({
  ...trail,
  grade: mapper(trail.grade),
});

const mapBenchExec =
  <Input, Mapped, R extends Schema.JsonObject>(
    mapper: (grade: Input) => Mapped,
    exec: Metric.Bench.Exec<Mapped, R>,
  ): Metric.Bench.Exec<Input, R> =>
  (results, delta, prev) =>
    exec(
      Object.fromEntries(
        Object.entries(results).map(([task, trails]) => [
          task,
          trails.map((trail) => mapTrail(mapper, trail)),
        ]),
      ),
      { ...mapTrail(mapper, delta), task: delta.task },
      prev,
    );

const mapTaskExec =
  <Input, Mapped, R extends Schema.JsonObject>(
    mapper: (grade: Input) => Mapped,
    exec: Metric.Task.Exec<Mapped, R>,
  ): Metric.Task.Exec<Input, R> =>
  (results, delta, prev) =>
    exec(
      results.map((trail) => mapTrail(mapper, trail)),
      mapTrail(mapper, delta),
      prev,
    );

const attachMetric =
  <G, M extends Schema.JsonObject>(
    exec: Metric.Bench.Exec<G, M>,
    options: MetricOptions<M>,
  ): MetricBuilder<G> =>
  <Grade extends GradeSchema<G>, S extends Task.Stage, E, R>(
    bench: Effect.Effect<Bench<TaskWithGrade<G, Grade, S>>, E, R>,
  ) =>
    Effect.flatMap(bench, (bench) =>
      Metric.Bench.make({ ...options, exec }).pipe(
        Effect.mapError(Error.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

const attachTaskMetric =
  <G, M extends Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Task.Exec<G, M>,
    options: TaskMetricOptions<M>,
  ): MetricBuilder<G> =>
  <Grade extends GradeSchema<G>, S extends Task.Stage, E, R>(
    bench: Effect.Effect<Bench<TaskWithGrade<G, Grade, S>>, E, R>,
  ) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return Metric.Task.make({ ...options, exec }).pipe(
        Effect.mapError(Error.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.metrics.push(castDraft(metric));
                break;
              }
            }
          }),
        ),
      );
    });

export const metric = <G, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: Metric.Bench.Exec<G, M>,
  options: MetricOptions<M> = {},
): MetricBuilder<G> => attachMetric(exec, options);

export const mapMetric = <G, Mapped, M extends Schema.JsonObject = Schema.JsonObject>(
  mapper: (grade: NoInfer<G>) => Mapped,
  exec: Metric.Bench.Exec<Mapped, M>,
  options: MetricOptions<M> = {},
): MetricBuilder<G> => attachMetric(mapBenchExec(mapper, exec), options);

export const taskMetric = <G, M extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  exec: Metric.Task.Exec<G, M>,
  options: TaskMetricOptions<M> = {},
): MetricBuilder<G> => attachTaskMetric(taskId, exec, options);

export const mapTaskMetric = <G, Mapped, M extends Schema.JsonObject = Schema.JsonObject>(
  taskId: Task.ID,
  mapper: (grade: NoInfer<G>) => Mapped,
  exec: Metric.Task.Exec<Mapped, M>,
  options: TaskMetricOptions<M> = {},
): MetricBuilder<G> => attachTaskMetric(taskId, mapTaskExec(mapper, exec), options);

export const trajMetric =
  <M extends Schema.JsonObject = Schema.JsonObject>(
    taskId: Task.ID,
    exec: Metric.Traj.Exec<M>,
    options: TrajMetricOptions<M> = {},
  ): AttachedMetricBuilder =>
  <T extends Task.AnyTask, E, R>(bench: Effect.Effect<Bench<T>, E, R>) =>
    Effect.flatMap(bench, (bench) => {
      if (!bench.tasks.some((task) => task.metadata.id === taskId)) {
        return Effect.fail(Error.taskNotFound(taskId));
      }

      return Metric.Traj.make({ ...options, exec }).pipe(
        Effect.mapError(Error.init),
        Effect.map((metric) =>
          produce(bench, (draft) => {
            for (const task of draft.tasks) {
              if (task.metadata.id === taskId) {
                task.trajMetrics.push(castDraft(metric));
                break;
              }
            }
          }),
        ),
      );
    });
