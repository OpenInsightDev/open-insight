import { Data, Effect, type Schema } from "effect";
import { TaskError } from "./error.ts";
import type { Trajectory, Response } from "@open-insight/core/internal";
import type { Tool } from "effect/unstable/ai";

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
> = Fn<G, Tools, S, TaskError> &
  Readonly<{
    schema: S;
  }>;

export type Any = Aggregator<any, any, any>;
