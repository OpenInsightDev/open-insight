import { Data, Effect, flow, Option, type Schema } from "effect";
import * as Task from "./task.ts";
import { TaskError } from "./error.ts";
import type { Trajectory, Response } from "@open-insight/core/internal";
import { hasProperty } from "effect/Predicate";
import type { Override } from "#/utils/index.ts";

export class SessionResult extends Data.TaggedClass("SessionResult")<{
  trajectory: Trajectory.Trajectory;
  usage: Response.Usage | null;
}> {}

export class TrailResult<G extends Schema.Constraint = any> extends Data.TaggedClass(
  "TrailResult",
)<{
  grade: G["Type"];
  sessions: Array<SessionResult>;
}> {}

export class TaskResult<S extends Schema.Constraint = any> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type Aggregator<G extends Schema.Constraint, S extends Schema.Constraint> = ((
  trails: ReadonlyArray<TrailResult<G>>,
) => Effect.Effect<TaskResult<S>, TaskError>) &
  Readonly<{ schema: S }>;

export type Any = Aggregator<any, any>;

const Field: unique symbol = Symbol("Field");
export type Mixin<A extends Any> = Readonly<{ [Field]: A }>;

export type AggregatorOf<T> = T extends Mixin<infer A> ? A : never;
export const aggregatorOf = <T>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as AggregatorOf<T>) : null);

export type TaskResultOf<T> = T extends Mixin<infer A> ? TaskResult<A["schema"]> : never;

export const result =
  <T extends Task.Any, S extends Schema.Constraint>(
    schema: S,
    fn: (trails: ReadonlyArray<TrailResult<Task.GradeOf<T>>>) => Effect.Effect<S["Type"], unknown>,
  ) =>
  (task: T): Override<T, Mixin<Aggregator<Task.GradeOf<T>, S>>> => {
    const aggFn = flow(
      fn,
      Effect.map((result) => new TaskResult({ id: task.id, result })),
      Effect.mapError(TaskError.result),
    ) satisfies Omit<Aggregator<Task.GradeOf<T>, S>, "schema">;

    return Object.assign(task, { [Field]: Object.assign(aggFn, { schema }) });
  };
