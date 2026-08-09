/**
 * Convert an arbitrary JSON Schema object into a standalone TypeScript `.d.ts`
 * source string with the schema's actual (expanded) types.
 *
 * The function lowers the JSON Schema to an Effect schema AST, computes the
 * decoded ("type") side, then uses `SchemaRepresentation.toCodeDocument` to
 * obtain expanded TypeScript type strings for every root and named reference.
 *
 * @example
 * ```ts
 * const dts = jsonSchemaToDts({
 *   type: "object",
 *   properties: { id: { type: "integer" }, name: { type: "string" } },
 *   required: ["id"]
 * }, { rootName: "User" })
 *
 * // ->
 * // export type User = { readonly "id": number, readonly "name"?: string };
 * ```
 */

import * as JsonSchema from "effect/JsonSchema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaRepresentation from "effect/SchemaRepresentation";

export interface JsonSchemaToDtsOptions {
  /** Name of the export emitted for the root schema. Defaults to `"Root"`. */
  readonly rootName?: string;
  /**
   * Customize the emitted type name for a named reference (`$defs` key).
   * Defaults to the (sanitized) definition name.
   */
  readonly typeNameOf?: (definitionName: string) => string;
  /** Just wrap the output in `export type Root = ...` without a header comment. */
  readonly header?: string;
}

const DEFAULT_ROOT_NAME = "Root";

/**
 * Turn a named TS identifier (possibly with unsafe characters) into a legal
 * TypeScript type name.
 */
function sanitizeName(input: string): string {
  if (input.length === 0) return "_";
  let out = input.replace(/[^A-Za-z0-9_$]/g, "_");
  if (/^[0-9]/.test(out)) out = `_${out}`;
  return out;
}

type JsonSchemaObject = {
  readonly [key: string]: unknown;
};

/**
 * Wrap a plain JSON Schema object in the shape `fromJsonSchemaMultiDocument`
 * expects: move top-level `$defs` / `definitions` into the shared
 * `definitions` pool and rewrite local `$ref` pointers into bare definition
 * names.
 */
function toMultiDocument(schema: JsonSchemaObject): JsonSchema.MultiDocument<"draft-2020-12"> {
  const defs: Record<string, JsonSchemaObject> = {};
  for (const src of [schema.$defs, schema.definitions]) {
    if (src && typeof src === "object") {
      for (const [key, value] of Object.entries(src)) {
        if (value && typeof value === "object") defs[key] = value as JsonSchemaObject;
      }
    }
  }

  const clone = structuredClone(schema) as Record<string, unknown>;
  delete clone.$defs;
  delete clone.definitions;

  const rewrite = (node: unknown): void => {
    if (node && typeof node === "object") {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        const value = (node as Record<string, unknown>)[key];
        if (key === "$ref" && typeof value === "string") {
          (node as Record<string, unknown>)[key] = value
            .replace(/^#\/\$defs\//, "")
            .replace(/^#\/definitions\//, "");
        } else {
          rewrite(value);
        }
      }
    }
  };
  rewrite(clone);

  return {
    dialect: "draft-2020-12",
    schemas: [clone as JsonSchema.JsonSchema],
    definitions: defs,
  };
}

/**
 * Generate a standalone `.d.ts` source string from an arbitrary JSON Schema.
 *
 * @throws If the JSON Schema uses features not supported by Effect's JSON
 *         Schema importer (for example external/URI `$ref`s that do not point
 *         into the local `$defs` pool).
 */
export function jsonSchemaToDts(schema: unknown, options: JsonSchemaToDtsOptions = {}): string {
  const rootName = sanitizeName(options.rootName ?? DEFAULT_ROOT_NAME);
  const typeNameOf = options.typeNameOf ?? ((name: string): string => sanitizeName(name));

  const multi = toMultiDocument(schema as JsonSchemaObject);
  const roots = SchemaRepresentation.fromJsonSchemaMultiDocument(multi);

  const asts = roots.map((root) => SchemaAST.toType(root.ast));
  const [first, ...rest] = asts;
  const tuple = [first, ...rest] as [SchemaAST.AST, ...Array<SchemaAST.AST>];
  const document = SchemaRepresentation.toCodeDocument(
    SchemaRepresentation.toRepresentations(tuple),
  );

  const lines: Array<string> = [];
  if (options.header !== undefined) lines.push(options.header);
  if (options.header !== undefined) lines.push("");

  // Recursive definitions first (they may reference themselves).
  for (const [ref, code] of Object.entries(document.references.recursives)) {
    lines.push(`export type ${typeNameOf(ref)} = ${code.Type};`);
    lines.push("");
  }
  // Then named, non-recursive definitions.
  for (const { $ref, code } of document.references.nonRecursives) {
    lines.push(`export type ${typeNameOf($ref)} = ${code.Type};`);
    lines.push("");
  }
  // Finally the root(s).
  document.codes.forEach((code, index) => {
    const name = index === 0 ? rootName : `${rootName}${index}`;
    lines.push(`export type ${name} = ${code.Type};`);
    lines.push("");
  });

  let output = lines.join("\n");
  // `fromJsonSchema` represents unconstrained additional properties as
  // `Schema.Json`; replace with a self-contained `unknown`.
  output = output.replaceAll("Schema.Json", "unknown");

  return output.trimEnd();
}
