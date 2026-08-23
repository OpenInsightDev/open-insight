import { Snapshot } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Schema } from "effect";

export class Task<
  ID extends string = string,
  G extends Schema.Constraint = any,
> extends Data.Class<{
  _tag: ID;

  id: ID;
  description: string | null;

  snapshot: Snapshot.Template;
  grader: Grade.Grader<G>;
}> {}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;

export type Any = Task<any, any>;

type Options<G extends Schema.Constraint> = Readonly<{
  grader: Grade.Grader<G>;

  description?: string | null;
  snapshot?: Snapshot.Template;
}>;

export const make = <ID extends string, G extends Schema.Constraint>(
  id: ID,
  options: Options<G>,
) => {
  const { grader, description = null, snapshot = Snapshot.Alpine } = options;
  return new Task({ _tag: id, id, description, snapshot, grader });
};
