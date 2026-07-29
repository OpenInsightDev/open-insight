import * as Grade from "#/grade/index.ts";
import { Schema } from "effect";

export type JsonObjectSchema<T extends object = object> = Grade.ResultSchema<T>;

/** An empty extras schema for templates that do not need per-task extras. */
export const EmptyExtras = Schema.Record(Schema.String, Schema.Never);

/** A schema-only contract shared by every task in a bench. */
export type Template<
  GS extends Grade.ResultSchema = Grade.ResultSchema,
  ES extends JsonObjectSchema = JsonObjectSchema,
> = Readonly<{
  grade: GS;
  extras: ES;
}>;

export type Any = Template;

export type GradeResult<T extends Any> = T["grade"]["Type"];

export type Extras<T extends Any> = T["extras"]["Type"];

export type ExtrasEncoded<T extends Any> = T["extras"]["Encoded"];

/** Creates the schema contract for a family of tasks. */
export function make<GS extends Grade.ResultSchema, ES extends JsonObjectSchema>(
  options: Readonly<{
    grade: GS;
    extras: ES;
  }>,
): Template<GS, ES>;
export function make<GS extends Grade.ResultSchema>(
  options: Readonly<{
    grade: GS;
  }>,
): Template<GS, typeof EmptyExtras>;
export function make(
  options: Readonly<{
    grade: Grade.ResultSchema;
    extras?: JsonObjectSchema;
  }>,
): Template {
  return {
    grade: options.grade,
    extras: options.extras ?? EmptyExtras,
  };
}
