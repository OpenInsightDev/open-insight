import * as Grade from "#/grade/index.ts";
import type { Prompt, Snapshot } from "@open-insight/core/internal";
import { Schema } from "effect";

export interface Template<
  out Name extends string,
  out Config extends {
    readonly grade: Schema.Constraint;
    readonly extra: Schema.Constraint;
  },
> {
  readonly id: string;
  readonly name: Name;
  readonly description?: string;

  readonly gradeSchema: Config["grade"];
  readonly extraSchema: Config["extra"];

  taskMetrics: [];
}

export type NameOf<T> = T extends Template<infer Name, any> ? Name : never;
export type GradeOf<T> = T extends Template<any, infer Config> ? Config["grade"] : never;
export type GradeTypeOf<T> =
  T extends Template<any, infer Config> ? Config["grade"]["Type"] : never;
export type GradeEncodedOf<T> =
  T extends Template<any, infer Config> ? Config["grade"]["Encoded"] : never;
export type ExtraOf<T> = T extends Template<any, infer Config> ? Config["extra"] : never;
export type ExtraTypeOf<T> =
  T extends Template<any, infer Config> ? Config["extra"]["Type"] : never;
export type ExtraEncodedOf<T> =
  T extends Template<any, infer Config> ? Config["extra"]["Encoded"] : never;

export interface Any extends Template<
  any,
  {
    readonly grade: Schema.Top;
    readonly extra: Schema.Top;
  }
> {}

export class Passed extends Schema.Class<Passed>("Passed")({
  passed: Schema.Boolean,
}) {}

export const make = <
  const Name extends string,
  Grade extends Schema.Constraint = typeof Passed,
  Extra extends Schema.Constraint = Schema.Never,
>(
  name: Name,
  options?: {
    grade?: Grade;
    extra?: Extra;
  },
): Template<Name, { readonly grade: Grade; readonly extra: Extra }> => {
  const gradeSchema = options?.grade ?? Passed;
  const extraSchema = options?.extra ?? Schema.Never;

  return {
    id: name,
    name,
    gradeSchema,
    extraSchema,
  } as any;
};

export interface Task<T extends Any> {
  prompt: Prompt.Gen.Options;
  snapshot: Snapshot.Snapshot;
  grader: Grade.Grader<GradeOf<T>>;
}
