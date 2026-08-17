import { Schema } from "effect";

export class Empty extends Schema.Class<Empty>("Empty")({}) {}

export type Template<
  G extends Schema.Constraint = any,
  E extends Schema.Constraint = any,
> = Readonly<{
  Grade: G;
  Extra: E;
}>;
export type GradeOf<T> = T extends Template<infer G, infer _> ? G : never;
export type ExtraOf<T> = T extends Template<infer _, infer E> ? E : never;

export function make<G extends Schema.Constraint>(Grade: G): Template<G, typeof Empty>;
export function make<G extends Schema.Constraint, E extends Schema.Constraint>({
  Grade,
  Extra,
}: {
  Grade: G;
  Extra: E;
}): Template<G, E>;
export function make<G extends Schema.Constraint, E extends Schema.Constraint>(
  Grade: G,
  Extra?: E,
) {
  return {
    Grade,
    Extra: Extra ?? Empty,
  };
}
