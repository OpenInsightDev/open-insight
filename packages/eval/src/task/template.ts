import * as Grade from "#/grade/index.ts";
import { Schema } from "effect";

export type ExtrasSchema<T extends object = object> = Schema.Codec<T, Schema.JsonObject>;

/** An empty extras schema for templates that do not need per-task extras. */
export const EmptyExtras = Schema.Record(Schema.String, Schema.Never);

/** A schema-only contract shared by every task in a bench. */
export type Template<GS = Grade.ResultSchema, ES = ExtrasSchema> = Readonly<{
  Grade: GS;
  Extras: ES;
}>;

export type Any = Template<Grade.ResultSchema, ExtrasSchema>;

export type GradeResult<T extends Any> = T["Grade"]["Type"];

export type Extras<T extends Any> = T["Extras"]["Type"];

export type ExtrasEncoded<T extends Any> = T["Extras"]["Encoded"];

/** Creates a schema contract from struct field definitions. */
export function make<const GF extends Schema.Struct.Fields, const EF extends Schema.Struct.Fields>(
  options: Readonly<{
    grade: GF;
    extras: EF;
  }>,
): Template<Schema.Struct<GF>, Schema.Struct<EF>>;
export function make<const GF extends Schema.Struct.Fields>(
  options: Readonly<{
    grade: GF;
  }>,
): Template<Schema.Struct<GF>, typeof EmptyExtras>;
export function make(
  options: Readonly<{
    grade: Schema.Struct.Fields;
    extras?: Schema.Struct.Fields;
  }>,
) {
  return {
    Grade: Schema.Struct(options.grade),
    Extras: options.extras === undefined ? EmptyExtras : Schema.Struct(options.extras),
  };
}

/** Creates a schema contract from complete object schemas. */
export function from<GS extends Grade.ResultSchema, ES extends ExtrasSchema>(
  options: Readonly<{
    grade: GS;
    extras: ES;
  }>,
): Template<GS, ES>;
export function from<GS extends Grade.ResultSchema>(
  options: Readonly<{
    grade: GS;
  }>,
): Template<GS, typeof EmptyExtras>;
export function from(
  options: Readonly<{
    grade: Grade.ResultSchema;
    extras?: ExtrasSchema;
  }>,
): Template {
  return {
    Grade: options.grade,
    Extras: options.extras ?? EmptyExtras,
  };
}
