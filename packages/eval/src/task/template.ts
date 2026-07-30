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

export type Unknown = Template<Grade.ResultSchema, ExtrasSchema>;
export const Unknown = {
  Grade: Schema.Record(Schema.String, Schema.Json),
  Extras: Schema.Record(Schema.String, Schema.Json),
} satisfies Template<Grade.ResultSchema, ExtrasSchema>;

export type GradeResult<T extends Unknown> = T["Grade"]["Type"];
export type GradeResultEncoded<T extends Unknown> = T["Grade"]["Encoded"];
export type Extras<T extends Unknown> = T["Extras"]["Type"];
export type ExtrasEncoded<T extends Unknown> = T["Extras"]["Encoded"];

/** Creates a schema contract from struct field definitions. */
export function make<const GF extends Schema.Struct.Fields, const EF extends Schema.Struct.Fields>(
  options: Readonly<{
    Grade: GF;
    Extras: EF;
  }>,
): Template<Schema.Struct<GF>, Schema.Struct<EF>>;
export function make<const GF extends Schema.Struct.Fields>(
  options: Readonly<{
    Grade: GF;
  }>,
): Template<Schema.Struct<GF>, typeof EmptyExtras>;
export function make(
  options: Readonly<{
    Grade: Schema.Struct.Fields;
    Extras?: Schema.Struct.Fields;
  }>,
) {
  return {
    Grade: Schema.Struct(options.Grade),
    Extras: options.Extras === undefined ? EmptyExtras : Schema.Struct(options.Extras),
  };
}
