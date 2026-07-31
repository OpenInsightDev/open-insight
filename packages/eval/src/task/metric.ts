import * as Grade from "#/grade/index.ts";
import * as Metric from "#/metric/index.ts";
import type { TrailResult } from "#/eval/result.ts";
import type { Invariant } from "#/utils/variant.ts";
import { Effect, Schema } from "effect";
import { castDraft, produce } from "immer";
import type { Stage, Task } from "./build.ts";
import { Error } from "./error.ts";

type TaskMetricOptions<M extends Schema.JsonObject> = Omit<Metric.Task.Options<unknown, M>, "exec">;

type TrajMetricOptions<M extends Schema.JsonObject> = Omit<Metric.Traj.Options<M>, "exec">;

type GradeSchema<G> = Grade.Result & Readonly<{ Type: G }>;

type TaskWithGrade<G, Schema extends GradeSchema<G>, S extends Stage> = Omit<
  Task<Schema, S>,
  "_G"
> &
  Readonly<{ _G?: Invariant<G> }>;

type TaskMetric<G> = <Schema extends GradeSchema<G>, S extends Stage, E, R>(
  task: Effect.Effect<TaskWithGrade<G, Schema, S>, E, R>,
) => Effect.Effect<Task<Schema, S>, E | Error, R>;

type GradeMapper<G, Mapped> = (grade: NoInfer<G>) => Mapped;

type TaskExec<G, M extends Schema.JsonObject> = Metric.Task.Exec<G, M>;

const mapExec = <Input, Mapped, M extends Schema.JsonObject>(
  mapper: (grade: Input) => Mapped,
  exec: Metric.Task.Exec<Mapped, M>,
): Metric.Task.Exec<Input, M> => {
  const mapTrail = (trail: TrailResult<Input>): TrailResult<Mapped> => ({
    ...trail,
    grade: mapper(trail.grade),
  });

  return (results, delta, prev) => exec(results.map(mapTrail), mapTrail(delta), prev);
};

const makeMetric =
  <G, M extends Schema.JsonObject>(exec: TaskExec<G, M>, options: TaskMetricOptions<M>) =>
  <Grade extends GradeSchema<G>, S extends Stage, E, R>(
    task: Effect.Effect<TaskWithGrade<G, Grade, S>, E, R>,
  ) =>
    Effect.flatMap(task, (task) =>
      Metric.Task.make({ ...options, exec }).pipe(
        Effect.mapError(Error.metadata),
        Effect.map((metric) =>
          produce(task, (draft) => {
            draft.metrics.push(castDraft(metric));
          }),
        ),
      ),
    );

export const metric = <G, M extends Schema.JsonObject = Schema.JsonObject>(
  exec: TaskExec<G, M>,
  options: TaskMetricOptions<M> = {},
): TaskMetric<G> => makeMetric(exec, options);

export const mapMetric = <G, Mapped, M extends Schema.JsonObject = Schema.JsonObject>(
  mapper: GradeMapper<G, Mapped>,
  exec: TaskExec<Mapped, M>,
  options: TaskMetricOptions<M> = {},
): TaskMetric<G> => makeMetric(mapExec(mapper, exec), options);

export const trajMetric =
  <M extends Schema.JsonObject = Schema.JsonObject>(
    exec: Metric.Traj.Exec<M>,
    options: TrajMetricOptions<M> = {},
  ) =>
  <G extends Grade.Result, S extends Stage, E, R>(
    task: Effect.Effect<Task<G, S>, E, R>,
  ): Effect.Effect<Task<G, S>, E | Error, R> =>
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
