import { Effect, Function, Schema, SchemaTransformation, Stream } from "effect";
import { Response } from "effect/unstable/ai";
import {
  TextStartPart,
  DocumentSourcePart,
  ErrorPart,
  FilePart,
  FinishPart,
  ReasoningDeltaPart,
  ReasoningEndPart,
  ReasoningStartPart,
  ResponseMetadataPart,
  TextDeltaPart,
  TextEndPart,
  ToolApprovalRequestPart,
  ToolParamsDeltaPart,
  ToolParamsEndPart,
  ToolParamsStartPart,
  UrlSourcePart,
} from "effect/unstable/ai/Response";

// HACK ToolCallPart that can decode any tool name and params
export const AnyToolCallPart = Response.ToolCallPart("tool-call", Schema.Json).mapFields(
  (fields) => ({
    ...fields,
    name: Schema.String,
  }),
);
export type AnyToolCallPart = Schema.Schema.Type<typeof AnyToolCallPart>;

// HACK The `Response.ToolResultPart` schema keys its decoded/encoded structs by the
// specific tool `name` literal. Because the toolkit is not known before a part
// is observed on the wire, mirror `AnyToolCallPart` and relax `name` to any
// `Schema.String` on both the decoded and encoded structs, keeping the rest of
// the part shape (and its encode/decode transformation) intact.
const PartTypeId = "~effect/ai/Content/Part";

const baseToolResult = Response.ToolResultPart("tool-result", Schema.Json, Schema.Json);

// HACK ToolResultPart that can decode any tool name, result, and failure
export const AnyToolResultPart = baseToolResult.to
  .mapFields((fields) => ({
    ...fields,
    name: Schema.String,
  }))
  .pipe(
    Schema.encodeTo(
      baseToolResult.from.mapFields((fields) => ({
        ...fields,
        name: Schema.String,
      })),
      SchemaTransformation.transform({
        decode: (encoded) => ({
          ...encoded,
          [PartTypeId]: PartTypeId,
          providerExecuted: encoded.providerExecuted ?? false,
          metadata: encoded.metadata ?? {},
          encodedResult: encoded.result,
          preliminary: encoded.preliminary ?? false,
        }),
        encode: Function.identity,
      }),
    ),
  );
export type AnyToolResultPart = Schema.Schema.Type<typeof AnyToolResultPart>;

export const AnyStreamPart = Schema.Union([
  TextStartPart,
  TextDeltaPart,
  TextEndPart,
  ReasoningStartPart,
  ReasoningDeltaPart,
  ReasoningEndPart,
  ToolParamsStartPart,
  ToolParamsDeltaPart,
  ToolParamsEndPart,
  ToolApprovalRequestPart,
  AnyToolCallPart,
  AnyToolResultPart,
  FilePart,
  DocumentSourcePart,
  UrlSourcePart,
  ResponseMetadataPart,
  FinishPart,
  ErrorPart,
]);
export type AnyStreamPart = Schema.Schema.Type<typeof AnyStreamPart>;

// /**
//  * Decodes a single encoded stream part (`Response.StreamPartEncoded`) into its
//  * typed form, building a permissive toolkit from the tool name observed on each
//  * `tool-call`/`tool-result` part.
//  */
export const decodeResponseStreamPartEncoded = (
  encoded: Response.StreamPartEncoded,
): Effect.Effect<AnyStreamPart, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(AnyStreamPart)(encoded);

// /**
//  * Decodes a stream of encoded response stream parts
//  * (`Response.StreamPartEncoded`) into typed stream parts, one per event.
//  */
export const decodeResponseStream = <E, R>(
  stream: Stream.Stream<Response.StreamPartEncoded, E, R>,
): Stream.Stream<AnyStreamPart, E | Schema.SchemaError, R> =>
  stream.pipe(Stream.mapEffect(decodeResponseStreamPartEncoded));

/**
 * Encodes a typed stream part (`AnyStreamPart`) back into its encoded wire
 * form (`Response.StreamPartEncoded`), the inverse of
 * {@link decodeResponseStreamPartEncoded}.
 */
export const encodeResponseStreamPartEncoded = (
  part: AnyStreamPart,
): Effect.Effect<Response.StreamPartEncoded, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(AnyStreamPart)(part);
