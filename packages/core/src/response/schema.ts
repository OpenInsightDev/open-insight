import { Function, Schema, SchemaTransformation } from "effect";
import type { Tool, Toolkit } from "effect/unstable/ai";
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
  ToolCallPart,
  ToolResultPart,
  StreamPart,
  type StreamPartEncoded,
  TextPart,
  ReasoningPart,
} from "effect/unstable/ai/Response";

// HACK ToolCallPart that can decode any tool name and params
export const AnyToolCallPart = ToolCallPart("any-tool-call", Schema.Json).mapFields((fields) => ({
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

const baseToolResult = ToolResultPart("any-tool-result", Schema.Json, Schema.Json);

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

export const AnyAggPart = <T extends Toolkit.Any | Toolkit.WithHandler<any>>(
  toolkit: T,
): Schema.Codec<
  StreamPart<T extends Toolkit.Any ? Toolkit.Tools<T> : Toolkit.WithHandlerTools<T>>,
  StreamPartEncoded,
  Tool.ResultDecodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>,
  Tool.ResultEncodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>
> => {
  const toolCalls: Array<Schema.Top> = [];
  const toolResults: Array<Schema.Top> = [];
  for (const tool of Object.values(toolkit.tools as Record<string, Tool.Any>)) {
    const toolCall = ToolCallPart(tool.name, tool.parametersSchema);
    const toolResult = ToolResultPart(tool.name, tool.successSchema, tool.failureSchema);
    toolCalls.push(toolCall);
    toolResults.push(toolResult);
  }
  return Schema.Union([
    TextPart,
    ReasoningPart,
    AnyToolCallPart,
    AnyToolResultPart,
    ToolApprovalRequestPart,
    FilePart,
    DocumentSourcePart,
    UrlSourcePart,
    ResponseMetadataPart,
    FinishPart,
    ErrorPart,
    ...toolCalls,
    ...toolResults,
  ]) as any;
};

export const AnyStreamPart = <T extends Toolkit.Any | Toolkit.WithHandler<any>>(
  toolkit: T,
): Schema.Codec<
  StreamPart<T extends Toolkit.Any ? Toolkit.Tools<T> : Toolkit.WithHandlerTools<T>>,
  StreamPartEncoded,
  Tool.ResultDecodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>,
  Tool.ResultEncodingServices<Toolkit.Tools<T>[keyof Toolkit.Tools<T>]>
> => {
  const toolCalls: Array<Schema.Top> = [];
  const toolResults: Array<Schema.Top> = [];
  for (const tool of Object.values(toolkit.tools as Record<string, Tool.Any>)) {
    const toolCall = ToolCallPart(tool.name, tool.parametersSchema);
    const toolResult = ToolResultPart(tool.name, tool.successSchema, tool.failureSchema);
    toolCalls.push(toolCall);
    toolResults.push(toolResult);
  }
  return Schema.Union([
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
    FilePart,
    DocumentSourcePart,
    UrlSourcePart,
    ResponseMetadataPart,
    FinishPart,
    ErrorPart,
    ...toolCalls,
    AnyToolCallPart,
    ...toolResults,
    AnyToolResultPart,
  ]) as any;
};
