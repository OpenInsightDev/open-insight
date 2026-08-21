import { Snapshot, type Prompt } from "@open-insight/core/internal";
import * as Grade from "#/grade/index.ts";
import { Effect, Schema } from "effect";

export interface Task<out Name extends string, G extends Schema.Constraint> {
  readonly name: Name;
  readonly description: string | null;

  readonly snapshot: Snapshot.Template;
  readonly prompt: Prompt.Gen.Options;
  readonly grader: Grade.Grader<G>;
}

export type GradeOf<T> = T extends Task<infer _, infer G> ? G : never;

export type Any = Task<string, any>;

type Options<G extends Schema.Constraint> = Readonly<{
  prompt: Prompt.Gen.Options;
  grader: Grade.Grader<G>;

  description?: string | null;
  snapshot?: Snapshot.Template;
}>;

export const make = <Name extends string, G extends Schema.Constraint>(
  name: Name,
  options: Options<G>,
) => {
  const { prompt, grader, description = null, snapshot = Snapshot.Alpine } = options;
  return Effect.succeed({
    name,
    description,
    snapshot,
    prompt,
    grader,
  } satisfies Task<Name, G>);
};
