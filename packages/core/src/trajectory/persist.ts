import { Effect, FileSystem, JsonSchema, Schema, Sink, Stream } from "effect";
import { Ndjson } from "effect/unstable/encoding";
import { Tool, Toolkit } from "effect/unstable/ai";
import { TrajectoryError } from "./error.ts";
import type { PartEncoded } from "./trajectory.ts";

type JsonSchemaDocument = JsonSchema.Document<"draft-2020-12">;

const mergeDefinitions = (
  target: Record<string, JsonSchema.JsonSchema>,
  document: JsonSchemaDocument,
): void => {
  Object.assign(target, document.definitions);
};

const toolkitJsonSchema = (toolkit: Toolkit.Any): JsonSchema.JsonSchema => {
  const properties: Record<string, JsonSchema.JsonSchema> = {};
  const definitions: Record<string, JsonSchema.JsonSchema> = {};

  for (const tool of Object.values(toolkit.tools) as ReadonlyArray<Tool.Any>) {
    const parameters = Schema.toJsonSchemaDocument(tool.parametersSchema);
    const success = Schema.toJsonSchemaDocument(tool.successSchema);
    const failure = Schema.toJsonSchemaDocument(tool.failureSchema);

    mergeDefinitions(definitions, parameters);
    mergeDefinitions(definitions, success);
    mergeDefinitions(definitions, failure);

    properties[tool.name] = {
      type: "object",
      properties: {
        id: { type: "string", const: tool.id },
        name: { type: "string", const: tool.name },
        ...(tool.description === undefined
          ? {}
          : { description: { type: "string", const: tool.description } }),
        failureMode: { type: "string", enum: [tool.failureMode] },
        parameters: parameters.schema,
        success: success.schema,
        failure: failure.schema,
      },
      required: ["id", "name", "failureMode", "parameters", "success", "failure"],
      additionalProperties: false,
    };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Trajectory toolkit",
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(Object.keys(definitions).length === 0 ? {} : { $defs: definitions }),
  };
};

/**
 * Creates a sink that persists a trajectory as a `.traj` JSONL file.
 *
 * The first line contains the toolkit JSON Schema. Every following line is one
 * encoded trajectory part. The file is overwritten when the sink starts.
 */
export const persist = (
  path: string,
  toolkit: Toolkit.Any,
): Sink.Sink<void, PartEncoded, never, TrajectoryError, FileSystem.FileSystem> =>
  Sink.make<PartEncoded>()((parts) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* Stream.concat(Stream.succeed(toolkitJsonSchema(toolkit)), parts)
        .pipe(Stream.pipeThroughChannel(Ndjson.encode()))
        .pipe(Stream.run(fs.sink(path)))
        .pipe(Effect.mapError(TrajectoryError.storage));
    }),
  );
