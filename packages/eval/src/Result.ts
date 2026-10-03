import { Trajectory } from "@open-insight/trajectory";
import { Data, Effect, Schema, Stream } from "effect";
import * as Task from "#/Task.ts";

export class ResultError extends Data.TaggedError("ResultError")<{
  readonly cause: unknown;
}> {}

export type TrailResult<G extends Schema.Constraint> = Readonly<{
  grade: G["Type"];
  sessions: Stream.Stream<Trajectory.Any, ResultError>;
}>;

export type AnyTrailResult = TrailResult<any>;

export class TaskResult<S extends Schema.Constraint> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

type TrailReduceExec<G extends Schema.Constraint, S extends Schema.Constraint> = (
  trailResults: ReadonlyArray<TrailResult<G>>,
) => Effect.Effect<TaskResult<NoInfer<S>>, ResultError>;

export type TrailReducer<G extends Schema.Constraint, S extends Schema.Constraint> = Readonly<{
  schema: S;
  exec: TrailReduceExec<G, S>;
}>;

export const reduceTrails =
  <S extends Schema.Constraint>(schema: S) =>
  <G extends Schema.Constraint>(exec: TrailReduceExec<G, S>) =>
  (task: Task.Task<any, G>) => {};

export const reduceTasks = <S extends Schema.Constraint>(schema: S) => {};

export class Resultkit<Tasks extends Record<string, Task.Any>> extends Data.Class<{}> {}
