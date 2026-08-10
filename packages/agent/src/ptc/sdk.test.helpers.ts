import { JsonSchema } from "effect";
import type { ToolSpec } from "./schema.ts";

/** Hand-crafted specs used so the SDK tests don't depend on Effect AI tools. */
export const toolSpecs: ReadonlyArray<ToolSpec> = [
  {
    name: "Greet",
    description: "Say hello to someone.",
    failureMode: "return",
    parametersJsonSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    } as JsonSchema.JsonSchema,
    successJsonSchema: { type: "string" } as JsonSchema.JsonSchema,
    failureJsonSchema: { type: "string" } as JsonSchema.JsonSchema,
  },
  {
    name: "Add",
    description: "Add two integers.",
    failureMode: "return",
    parametersJsonSchema: {
      type: "object",
      properties: {
        a: { type: "integer" },
        b: { type: "integer" },
      },
      required: ["a", "b"],
    } as JsonSchema.JsonSchema,
    successJsonSchema: { type: "integer" } as JsonSchema.JsonSchema,
    failureJsonSchema: { type: "string" } as JsonSchema.JsonSchema,
  },
];
