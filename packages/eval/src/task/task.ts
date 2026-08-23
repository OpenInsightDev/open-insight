import { Snapshot, type Prompt } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Schema } from "effect";

export class Task<
  Name extends string = string,
  G extends Schema.Constraint = any,
> extends Data.Class<{
  name: Name;
  description: string | null;

  snapshot: Snapshot.Template;
  prompt: Prompt.Fn.Init;
  grader: Grade.Grader<G>;
}> {}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;

export type Any = Task<string, any>;

type Options<G extends Schema.Constraint> = Readonly<{
  grader: Grade.Grader<G>;

  description?: string | null;
  snapshot?: Snapshot.Template;
}>;

export const make = <Name extends string, G extends Schema.Constraint>(
  name: Name,
  options: Options<G>,
) => {
  const { prompt, grader, description = null, snapshot = Snapshot.Alpine } = options;
  return new Task({ name, description, snapshot, prompt, grader });
};
