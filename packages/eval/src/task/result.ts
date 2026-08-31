import { Data, Effect, Option, type Schema } from "effect";
import * as Grade from "#/grade/index.ts";
import * as Task from "./task.ts";
import { TaskError } from "./error.ts";
import type { Trajectory, Response } from "@open-insight/core/internal";
import type { Tool } from "effect/unstable/ai";
import { hasProperty } from "effect/Predicate";

export class SessionResult<Tools extends Record<string, Tool.Any>> extends Data.TaggedClass(
  "SessionResult",
)<{
  trajectory: Trajectory.Trajectory<Tools>;
  usage: Response.Usage | null;
}> {}

export class TrailResult<
  G extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
> extends Data.TaggedClass("TrailResult")<{
  grade: G["Type"];
  sessions: Array<SessionResult<Tools>>;
}> {}

export class TaskResult<S extends Schema.Constraint> extends Data.TaggedClass("TaskResult")<{
  id: string;
  result: S["Type"];
}> {}

export type Fn<
  G extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  S extends Schema.Constraint,
  E = unknown,
  R = never,
> = (trails: ReadonlyArray<TrailResult<G, Tools>>) => Effect.Effect<TaskResult<S>, E, R>;

export type Aggregator<
  G extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  S extends Schema.Constraint,
> = Fn<G, Tools, S, TaskError> & Readonly<{ schema: S }>;

export type Any = Aggregator<any, any, any>;

const Field: unique symbol = Symbol("Field");
export type Mixin<A extends Any> = Readonly<{ [Field]: A }>;

export type AggregatorOf<T> = T extends Mixin<infer A> ? A : never;
export const aggregatorOf = <T>(value: T) =>
  Option.fromNullOr(hasProperty(value, Field) ? (value[Field] as AggregatorOf<T>) : null);

export const aggregate = <
  GradeResult extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
  S extends Schema.Constraint,
  E,
  R,
>(
  schema: S,
  fn: Fn<GradeResult, Tools, S, E, R>,
) =>
  Effect.fn(function* <Grader extends Grade.Grader<GradeResult>, T extends Task.Task<any, Grader>>(
    task: T,
  ): Effect.fn.Return<T & Mixin<Aggregator<GradeResult, Tools, S>>, E | TaskError, R> {
    const ctx = yield* Effect.context<R>();

    const aggFn = ((trails) =>
      fn(trails).pipe(Effect.provide(ctx), Effect.mapError(TaskError.result))) satisfies Fn<
      GradeResult,
      Tools,
      S,
      TaskError
    >;

    const agg = Object.assign(aggFn, { schema });

    return Object.assign(task, { [Field]: agg });
  });
