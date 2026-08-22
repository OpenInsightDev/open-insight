import { Snapshot, type Prompt } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Data, Schema } from "effect";
import * as Result from "./result.ts";

export class Task<
  out Name extends string,
  G extends Schema.Constraint,
  R extends Schema.Constraint = Schema.Void,
> extends Data.Class<{
  name: Name;
  description: string | null;

  snapshot: Snapshot.Template;
  prompt: Prompt.Gen.Options;
  grader: Grade.Grader<G>;

  result?: Result.Fn<G, R>;
}> {}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;

export type Any = Task<string, any, any>;

type Options<G extends Schema.Constraint, R extends Schema.Constraint> = Readonly<{
  prompt: Prompt.Gen.Options;
  grader: Grade.Grader<G>;

  description?: string | null;
  snapshot?: Snapshot.Template;
  result?: Result.Fn<G, R>;
}>;

export const make = <Name extends string, G extends Schema.Constraint, R extends Schema.Constraint>(
  name: Name,
  options: Options<G, R>,
) => {
  const { prompt, grader, description = null, snapshot = Snapshot.Alpine, result } = options;
  return new Task({
    name,
    description,
    snapshot,
    prompt,
    grader,
    result,
  });
};
