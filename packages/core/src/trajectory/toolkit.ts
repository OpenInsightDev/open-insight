import { JsonSchema, Schema } from "effect";
import type { Toolkit } from "effect/unstable/ai";

export type JsonSchemaDocument = JsonSchema.Document<"draft-2020-12">;

export type ToolkitJsonSchema = Record<
  string,
  {
    parameters: JsonSchemaDocument;
    success: JsonSchemaDocument;
    failure: JsonSchemaDocument;
  }
>;

export const toJsonSchema = (toolkit: Toolkit.Any): ToolkitJsonSchema =>
  Object.fromEntries(
    Object.entries(toolkit.tools).map(
      ([name, { parametersSchema, successSchema, failureSchema }]) => [
        name,
        {
          parameters: Schema.toJsonSchemaDocument(parametersSchema),
          success: Schema.toJsonSchemaDocument(successSchema),
          failure: Schema.toJsonSchemaDocument(failureSchema),
        },
      ],
    ),
  );
