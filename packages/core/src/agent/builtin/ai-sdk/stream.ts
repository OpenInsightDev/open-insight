import type { GeneratedFile, LanguageModelUsage, TextStreamPart, ToolSet } from "ai";
import { Effect, Option, Schema, Stream } from "effect";
import { Response, Tool } from "effect/unstable/ai";

export class AiSdkStreamError extends Schema.TaggedErrorClass<AiSdkStreamError>()(
  "AiSdkStreamError",
  {
    cause: Schema.Defect(),
  },
) {}

export type AiSdkTools = Record<string, Tool.AnyDynamic>;
export type AiSdkStreamPart = TextStreamPart<ToolSet>;
export type StreamPart = Response.StreamPart<AiSdkTools>;

type MetadataInput = Readonly<{
  type: string;
  providerMetadata?: unknown;
}>;

type AiSdkFilePart = Readonly<{
  type: "file" | "reasoning-file";
  file: GeneratedFile;
  providerMetadata?: unknown;
}>;

type AiSdkUrlSourcePart = Readonly<{
  type: "source";
  sourceType: "url";
  id: string;
  url: string;
  title?: string;
  providerMetadata?: unknown;
}>;

type AiSdkDocumentSourcePart = Readonly<{
  type: "source";
  sourceType: "document";
  id: string;
  mediaType: string;
  title: string;
  filename?: string;
  providerMetadata?: unknown;
}>;

type AiSdkSourcePart = AiSdkUrlSourcePart | AiSdkDocumentSourcePart;

type AiSdkToolDetailsPart = Readonly<{
  dynamic?: boolean;
  title?: string;
  toolMetadata?: unknown;
}>;

const decodeJsonOption = Schema.decodeUnknownOption(Schema.Json);
const decodeDocumentSourcePart = Schema.decodeUnknownOption(Response.DocumentSourcePart);
const decodeUrlSourcePart = Schema.decodeUnknownOption(Response.UrlSourcePart);

const jsonOrOmitted = (value: unknown): Schema.Json =>
  Option.getOrElse(decodeJsonOption(value), () => ({
    omitted: true,
    reason: "non_json_value",
  }));

const metadataPart = (part: MetadataInput, details: Schema.JsonObject = {}): StreamPart =>
  Response.makePart("response-metadata", {
    id: undefined,
    modelId: undefined,
    timestamp: undefined,
    request: undefined,
    metadata: aiSdkMetadata(part, details),
  });

const aiSdkMetadata = (
  part: MetadataInput,
  details: Schema.JsonObject = {},
): Response.ProviderMetadata => {
  const partDetails: Schema.JsonObject = {
    ...details,
    type: part.type,
  };
  const metadata = part.providerMetadata;

  return {
    aiSdk:
      metadata === undefined
        ? {
            part: partDetails,
          }
        : {
            part: partDetails,
            providerMetadata: jsonOrOmitted(metadata),
          },
  };
};

const usageFromAiSdk = (usage: LanguageModelUsage): Response.Usage =>
  new Response.Usage({
    inputTokens: {
      uncached: usage.inputTokenDetails.noCacheTokens,
      total: usage.inputTokens,
      cacheRead: usage.inputTokenDetails.cacheReadTokens,
      cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: usage.outputTokenDetails.textTokens,
      reasoning: usage.outputTokenDetails.reasoningTokens,
    },
  });

const emptyUsage = () =>
  new Response.Usage({
    inputTokens: {
      uncached: undefined,
      total: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  });

const finishReason = (
  reason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other",
) => reason;

const filePart = (part: AiSdkFilePart): ReadonlyArray<StreamPart> => {
  const file = fileFromPart(part.file);
  return file === undefined
    ? [metadataPart(part, { reason: "file_data_unavailable" })]
    : [
        Response.makePart("file", {
          mediaType: file.mediaType,
          data: file.data,
          metadata: aiSdkMetadata(
            part,
            part.type === "reasoning-file" ? { content: "reasoning" } : {},
          ),
        }),
      ];
};

const fileFromPart = (
  file: GeneratedFile,
): { readonly mediaType: string; readonly data: Uint8Array } | undefined => {
  try {
    return {
      mediaType: file.mediaType,
      data: file.uint8Array,
    };
  } catch {
    return undefined;
  }
};

const sourcePart = (part: AiSdkSourcePart): ReadonlyArray<StreamPart> => {
  switch (part.sourceType) {
    case "url":
      return urlSourcePart(part);
    case "document":
      return documentSourcePart(part);
  }
};

const urlSourcePart = (part: AiSdkUrlSourcePart): ReadonlyArray<StreamPart> => {
  const source = decodeUrlSourcePart({
    type: "source",
    sourceType: "url",
    id: part.id,
    url: part.url,
    title: part.title ?? part.url,
    metadata: aiSdkMetadata(part),
  });

  return Option.match(source, {
    onNone: () => [metadataPart(part, { reason: "invalid_source_url" })],
    onSome: (sourcePart) => [sourcePart],
  });
};

const documentSourcePart = (part: AiSdkDocumentSourcePart): ReadonlyArray<StreamPart> => {
  const source = decodeDocumentSourcePart({
    type: "source",
    sourceType: "document" as const,
    id: part.id,
    mediaType: part.mediaType,
    title: part.title,
    fileName: part.filename,
    metadata: aiSdkMetadata(part),
  });

  return Option.match(source, {
    onNone: () => [metadataPart(part, { reason: "invalid_document_source" })],
    onSome: (sourcePart) => [sourcePart],
  });
};

const toolCallDetails = (part: AiSdkToolDetailsPart): Schema.JsonObject => ({
  dynamic: part.dynamic ?? false,
  title: part.title ?? null,
  toolMetadata: jsonOrOmitted(part.toolMetadata),
});

const partToParts = (part: AiSdkStreamPart): ReadonlyArray<StreamPart> => {
  switch (part.type) {
    case "text-start":
      return [Response.makePart("text-start", { id: part.id, metadata: aiSdkMetadata(part) })];
    case "text-delta":
      return [
        Response.makePart("text-delta", {
          id: part.id,
          delta: part.text,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "text-end":
      return [Response.makePart("text-end", { id: part.id, metadata: aiSdkMetadata(part) })];
    case "reasoning-start":
      return [
        Response.makePart("reasoning-start", {
          id: part.id,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "reasoning-delta":
      return [
        Response.makePart("reasoning-delta", {
          id: part.id,
          delta: part.text,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "reasoning-end":
      return [
        Response.makePart("reasoning-end", {
          id: part.id,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "tool-input-start":
      return [
        Response.makePart("tool-params-start", {
          id: part.id,
          name: part.toolName,
          providerExecuted: part.providerExecuted ?? false,
          metadata: aiSdkMetadata(part, {
            dynamic: part.dynamic ?? false,
            title: part.title ?? null,
            toolMetadata: jsonOrOmitted(part.toolMetadata),
          }),
        }),
      ];
    case "tool-input-delta":
      return [
        Response.makePart("tool-params-delta", {
          id: part.id,
          delta: part.delta,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "tool-input-end":
      return [
        Response.makePart("tool-params-end", {
          id: part.id,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "tool-call":
      return [
        Response.toolCallPart({
          id: part.toolCallId,
          name: part.toolName,
          params: part.input,
          providerExecuted: part.providerExecuted ?? false,
          metadata: aiSdkMetadata(part, toolCallDetails(part)),
        }),
      ];
    case "tool-result":
      return [
        Response.toolResultPart({
          id: part.toolCallId,
          name: part.toolName,
          isFailure: false,
          result: part.output,
          encodedResult: part.output,
          providerExecuted: part.providerExecuted ?? false,
          preliminary: part.preliminary ?? false,
          metadata: aiSdkMetadata(part, toolCallDetails(part)),
        }),
      ];
    case "tool-error": {
      const result = {
        error: part.error,
        input: part.input,
      };
      return [
        Response.toolResultPart({
          id: part.toolCallId,
          name: part.toolName,
          isFailure: true,
          result,
          encodedResult: result,
          providerExecuted: part.providerExecuted ?? false,
          preliminary: false,
          metadata: aiSdkMetadata(part, toolCallDetails(part)),
        }),
      ];
    }
    case "tool-output-denied": {
      const result = {
        denied: true,
      };
      return [
        Response.toolResultPart({
          id: part.toolCallId,
          name: part.toolName,
          isFailure: true,
          result,
          encodedResult: result,
          providerExecuted: part.providerExecuted ?? false,
          preliminary: false,
          metadata: aiSdkMetadata(part, { dynamic: part.dynamic ?? false }),
        }),
      ];
    }
    case "tool-approval-request":
      return [
        Response.toolApprovalRequestPart({
          approvalId: part.approvalId,
          toolCallId: part.toolCall.toolCallId,
          metadata: aiSdkMetadata(part, {
            isAutomatic: part.isAutomatic ?? false,
            signature: part.signature ?? null,
            toolCall: jsonOrOmitted(part.toolCall),
          }),
        }),
      ];
    case "tool-approval-response":
      return [
        metadataPart(part, {
          approvalId: part.approvalId,
          approved: part.approved,
          providerExecuted: part.providerExecuted ?? false,
          reason: part.reason ?? null,
          toolCall: jsonOrOmitted(part.toolCall),
        }),
      ];
    case "file":
    case "reasoning-file":
      return filePart(part);
    case "source":
      return sourcePart(part);
    case "finish":
      return [
        Response.makePart("finish", {
          reason: finishReason(part.finishReason),
          usage: usageFromAiSdk(part.totalUsage),
          response: undefined,
          metadata: aiSdkMetadata(part, { rawFinishReason: part.rawFinishReason ?? null }),
        }),
      ];
    case "abort":
      return [
        Response.makePart("finish", {
          reason: "unknown",
          usage: emptyUsage(),
          response: undefined,
          metadata: aiSdkMetadata(part, { reason: part.reason ?? null }),
        }),
      ];
    case "error":
      return [
        Response.makePart("error", {
          error: part.error,
          metadata: aiSdkMetadata(part),
        }),
      ];
    case "start":
      return [metadataPart(part)];
    case "start-step":
      return [
        metadataPart(part, {
          request: jsonOrOmitted(part.request),
          warnings: jsonOrOmitted(part.warnings),
        }),
      ];
    case "finish-step":
      return [
        metadataPart(part, {
          finishReason: part.finishReason,
          performance: jsonOrOmitted(part.performance),
          rawFinishReason: part.rawFinishReason ?? null,
          response: jsonOrOmitted(part.response),
          usage: jsonOrOmitted(part.usage),
        }),
      ];
    case "custom":
      return [metadataPart(part, { kind: part.kind })];
    case "raw":
      return [metadataPart(part, { rawValue: jsonOrOmitted(part.rawValue) })];
  }
};

export const transform = Effect.fn(function* <E, R>(
  stream: Stream.Stream<AiSdkStreamPart, E, R>,
): Effect.fn.Return<Stream.Stream<StreamPart, E, R>> {
  return yield* Effect.succeed(
    stream.pipe(Stream.flatMap((part) => Stream.fromIterable(partToParts(part)))),
  );
}, Stream.unwrap);

export const fromAiStream = Effect.fn(function* (
  stream: AsyncIterable<AiSdkStreamPart>,
): Effect.fn.Return<Stream.Stream<StreamPart, AiSdkStreamError>> {
  return yield* Effect.succeed(
    Stream.fromAsyncIterable(stream, (cause) => AiSdkStreamError.make({ cause })).pipe(transform),
  );
}, Stream.unwrap);
