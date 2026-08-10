/**
 * Tool introspection: turns the user-defined tools of an Effect AI
 * `Toolkit.WithHandler` into a plain, JSON-Schema-carrying description
 * (`ToolSpec`) that the SDK generator can consume.
 *
 * Each `Tool` exposes its `parametersSchema`, `successSchema`, `failureSchema`
 * and `failureMode`; we convert each schema into a JSON Schema so the SDK can
 * lower them to TypeScript types via `jsonSchemaToDts`.
 */
import type { JsonSchema } from "effect";
import { Tool, type Toolkit } from "effect/unstable/ai";

/** A plain, toolchain-agnostic description of a single tool. */
export type ToolSpec = Readonly<{
  readonly name: string;
  readonly description?: string;
  readonly failureMode: "error" | "return";
  readonly parametersJsonSchema: JsonSchema.JsonSchema;
  readonly successJsonSchema: JsonSchema.JsonSchema;
  readonly failureJsonSchema: JsonSchema.JsonSchema;
}>;

/** Lower a single Effect AI `Tool` into a {@link ToolSpec}. */
export const toSpec = (tool: Tool.Any): ToolSpec => ({
  name: tool.name,
  description: tool.description,
  failureMode: tool.failureMode,
  parametersJsonSchema: Tool.getJsonSchema(tool),
  successJsonSchema: Tool.getJsonSchemaFromSchema(tool.successSchema),
  failureJsonSchema: Tool.getJsonSchemaFromSchema(tool.failureSchema),
});

/**
 * Lower every tool in a handler-armed toolkit into an ordered array of
 * {@link ToolSpec}s.
 */
export const specsOf = (toolkit: Toolkit.WithHandler<any>): ReadonlyArray<ToolSpec> =>
  Object.values(toolkit.tools).map((tool) => toSpec(tool as Tool.Any));
