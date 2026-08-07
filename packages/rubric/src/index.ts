import type { Schema } from "effect";

export type Rubric<S extends Schema.Constraint> = Readonly<{
  outputSchema: S;
}>;

type Options = Readonly<{}>;

export const make =
  <S extends Schema.Constraint>(outputSchema: S) =>
  (options: Options) => {};
