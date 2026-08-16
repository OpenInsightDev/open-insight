import { Function, Schema, SchemaTransformation } from "effect";
import {
  TextPart,
  TextStartPart,
  DocumentSourcePart,
  ErrorPart,
  FilePart,
  FinishPart,
  ReasoningPart,
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
  ToolCallPart,
  ToolResultPart,
} from "effect/unstable/ai/Response";

// HACK ToolCallPart that can decode any tool name and params
export const AnyToolCallPart = ToolCallPart("tool-call", Schema.Json).mapFields((fields) => ({
  ...fields,
  name: Schema.String,
}));
export type AnyToolCallPart = Schema.Schema.Type<typeof AnyToolCallPart>;

// HACK The `Response.ToolResultPart` schema keys its decoded/encoded structs by the
// specific tool `name` literal. Because the toolkit is not known before a part
// is observed on the wire, mirror `AnyToolCallPart` and relax `name` to any
// `Schema.String` on both the decoded and encoded structs, keeping the rest of
// the part shape (and its encode/decode transformation) intact.
const PartTypeId = "~effect/ai/Content/Part";

const baseToolResult = ToolResultPart("tool-result", Schema.Json, Schema.Json);

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

export const AnyPart = Schema.Union([
  TextPart,
  TextStartPart,
  TextDeltaPart,
  TextEndPart,
  ReasoningPart,
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
export type AnyPart = Schema.Schema.Type<typeof AnyPart>;
