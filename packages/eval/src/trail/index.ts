import type { Prompt, Response } from "@open-insight/core/internal";
import { Data, Stream, type Schema } from "effect";
import type { Tool } from "effect/unstable/ai";
import * as Grade from "#/grade/index.ts";
import type { BivariantFn } from "#/utils/variant.ts";

export type SessionOutput = Readonly<{
  trajectory: Prompt.Trajectory;
  usage: Response.Usage | null;
}>;

export type TrailOutput<G extends Schema.Constraint> = Readonly<{
  grade: G["Type"];
  sessions: Array<SessionOutput>;
}>;

export type Result<G extends Schema.Constraint, S extends Schema.Constraint> = TrailOutput<G> &
  Readonly<{
    result: S["Type"];
  }>;

export type Exec<G extends Schema.Constraint, S extends Schema.Constraint> = BivariantFn<
  (output: TrailOutput<G>) => Result<G, S>
>;

export type Fn<G extends Schema.Constraint, S extends Schema.Constraint> = Exec<G, S> &
  Readonly<{
    schema: S;
  }>;

export type TrajMetricFn<G extends Schema.Constraint, Tools extends Record<string, Tool.Any>> = (
  stream: Stream.Stream<Prompt.Prompt | Response.AnyAggPart>,
) => {};

export class Trail<
  G extends Schema.Constraint,
  S extends Schema.Constraint,
  Tools extends Record<string, Tool.Any>,
> extends Data.Class<{
  grader: Grade.Grader<G>;
  toolkit: Tools;
  result: Fn<G, S> | null;
}> {}
