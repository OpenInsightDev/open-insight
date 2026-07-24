import { DefaultGeneratedFile } from "ai";
import type {
  GeneratedFile,
  LanguageModelUsage,
  ProviderMetadata,
  TextStreamPart,
  ToolSet,
} from "ai";
import { DateTime, Effect, Option, Schema, Stream } from "effect";
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

// =============================================================================
// Effect -> AI SDK
// =============================================================================

export class EffectToAiSdkStreamError extends Schema.TaggedErrorClass<EffectToAiSdkStreamError>()(
  "EffectToAiSdkStreamError",
  {
    reason: Schema.String,
    partType: Schema.optional(Schema.String),
    id: Schema.optional(Schema.String),
  },
) {}

export type ToolCallContext = Extract<AiSdkStreamPart, { readonly type: "tool-call" }>;

export type ToAiSdkStreamOptions = Readonly<{
  initialToolCalls?: ReadonlyMap<string, ToolCallContext>;
}>;

type Terminal =
  | Readonly<{ type: "finish"; part: Extract<StreamPart, { readonly type: "finish" }> }>
  | Readonly<{ type: "abort"; reason?: string; metadata?: unknown }>;

type ConversionState = Readonly<{
  activeText: ReadonlySet<string>;
  activeReasoning: ReadonlySet<string>;
  activeToolParams: ReadonlySet<string>;
  toolCalls: ReadonlyMap<string, ToolCallContext>;
  pendingTerminal: Terminal | undefined;
  lastPartWasError: boolean;
}>;

type EndSentinel = Readonly<{ type: "__effect_stream_end__" }>;
type InputPart = StreamPart | EndSentinel;

const endSentinel: EndSentinel = { type: "__effect_stream_end__" };
const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const metadataRecord = (metadata: unknown): Record<string, unknown> =>
  isRecord(metadata) ? metadata : {};

const aiSdkPartMetadata = (metadata: unknown): Record<string, unknown> => {
  const aiSdk = metadataRecord(metadata).aiSdk;
  return isRecord(aiSdk) && isRecord(aiSdk.part) ? aiSdk.part : {};
};

const metadataIsEmpty = (metadata: unknown): boolean =>
  Object.keys(metadataRecord(metadata)).length === 0;

const providerMetadata = (metadata: unknown): ProviderMetadata | undefined => {
  if (metadataIsEmpty(metadata)) return undefined;
  const record = metadataRecord(metadata);
  const aiSdk = record.aiSdk;
  if (isRecord(aiSdk) && "providerMetadata" in aiSdk) {
    const candidate = aiSdk.providerMetadata;
    if (isRecord(candidate)) {
      const valid = Object.values(candidate).every((value) => {
        const decoded = Option.getOrUndefined(decodeJson(value));
        return isRecord(decoded);
      });
      if (valid) return candidate as ProviderMetadata;
    }
    return { effect: { metadata: record } } as ProviderMetadata;
  }
  if (isRecord(aiSdk)) {
    const nativeMetadata = Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "aiSdk"),
    );
    return Object.keys(nativeMetadata).length === 0
      ? undefined
      : ({ effect: { metadata: nativeMetadata } } as ProviderMetadata);
  }
  return { effect: { metadata: record } } as ProviderMetadata;
};

const jsonObject = (value: unknown): Record<string, unknown> | undefined => {
  const decoded = Option.getOrUndefined(decodeJson(value));
  return isRecord(decoded) && !(decoded.omitted === true && decoded.reason === "non_json_value")
    ? decoded
    : undefined;
};

const encodeRequest = (request: unknown): unknown => {
  try {
    return request === undefined
      ? undefined
      : Schema.encodeUnknownSync(Response.HttpRequestDetails)(request);
  } catch {
    return undefined;
  }
};

const encodeResponse = (response: unknown): unknown => {
  try {
    return response === undefined
      ? undefined
      : Schema.encodeUnknownSync(Response.HttpResponseDetails)(response);
  } catch {
    return undefined;
  }
};

const customPart = (
  kind: `${string}.${string}`,
  metadata: unknown,
  details: Record<string, unknown> = {},
): AiSdkStreamPart => {
  const restored = providerMetadata(metadata) ?? {};
  const effectMetadata = isRecord(restored.effect) ? restored.effect : {};
  return {
    type: "custom",
    kind,
    providerMetadata: {
      ...restored,
      ...(Object.keys(details).length === 0 ? {} : { effect: { ...effectMetadata, ...details } }),
    } as ProviderMetadata,
  };
};

const companion = (
  type: string,
  metadata: unknown,
  details: Record<string, unknown> = {},
): ReadonlyArray<AiSdkStreamPart> =>
  providerMetadata(metadata) === undefined && Object.keys(details).length === 0
    ? []
    : [customPart(`effect.${type}-metadata`, metadata, details)];

const unsafePart = (part: unknown): AiSdkStreamPart => part as AiSdkStreamPart;
const unsafeToolCall = (part: unknown): ToolCallContext => part as ToolCallContext;

const usageToAiSdk = (usage: Response.Usage): LanguageModelUsage => {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const totalTokens =
    input.total === undefined && output.total === undefined
      ? undefined
      : (input.total ?? 0) + (output.total ?? 0);
  return {
    inputTokens: input.total,
    inputTokenDetails: {
      noCacheTokens: input.uncached,
      cacheReadTokens: input.cacheRead,
      cacheWriteTokens: input.cacheWrite,
    },
    outputTokens: output.total,
    outputTokenDetails: {
      textTokens: output.text,
      reasoningTokens: output.reasoning,
    },
    totalTokens,
  };
};

const finishReasonToAiSdk = (
  reason: Extract<StreamPart, { readonly type: "finish" }>["reason"],
  metadata: unknown,
): Pick<
  Extract<AiSdkStreamPart, { readonly type: "finish" }>,
  "finishReason" | "rawFinishReason"
> => {
  const details = aiSdkPartMetadata(metadata);
  const raw = typeof details.rawFinishReason === "string" ? details.rawFinishReason : undefined;
  if (reason === "pause" || reason === "unknown") {
    return { finishReason: "other", rawFinishReason: reason };
  }
  return { finishReason: reason, rawFinishReason: raw };
};

const error = (
  reason: string,
  part: { readonly type: string; readonly id?: string },
): Effect.Effect<never, EffectToAiSdkStreamError> =>
  Effect.fail(
    EffectToAiSdkStreamError.make({
      reason,
      partType: part.type,
      id: part.id,
    }),
  );

const stateWithSet = (
  state: ConversionState,
  key: "activeText" | "activeReasoning" | "activeToolParams",
  id: string,
  add: boolean,
): ConversionState => {
  const set = new Set(state[key]);
  if (add) set.add(id);
  else set.delete(id);
  return { ...state, [key]: set };
};

const toolCallFromPart = (
  part: Extract<StreamPart, { readonly type: "tool-call" }>,
): ToolCallContext => {
  const details = aiSdkPartMetadata(part.metadata);
  const toolMetadata = jsonObject(details.toolMetadata);
  return unsafeToolCall({
    type: "tool-call",
    toolCallId: part.id,
    toolName: part.name,
    input: part.params,
    dynamic: true,
    providerExecuted: part.providerExecuted,
    providerMetadata: providerMetadata(part.metadata),
    ...(typeof details.title === "string" ? { title: details.title } : {}),
    ...(toolMetadata === undefined ? {} : { toolMetadata }),
  });
};

const convertPart = (
  state: ConversionState,
  part: InputPart,
): Effect.Effect<
  readonly [ConversionState, ReadonlyArray<AiSdkStreamPart>],
  EffectToAiSdkStreamError
> => {
  if (part.type === "__effect_stream_end__") {
    if (state.pendingTerminal?.type === "abort") {
      return Effect.succeed([
        state,
        [
          ...companion("finish", state.pendingTerminal.metadata),
          unsafePart({ type: "abort", reason: state.pendingTerminal.reason }),
        ],
      ]);
    }
    if (state.pendingTerminal?.type === "finish") {
      if (
        state.activeText.size > 0 ||
        state.activeReasoning.size > 0 ||
        state.activeToolParams.size > 0
      ) {
        const unclosed =
          state.activeText.values().next().value ??
          state.activeReasoning.values().next().value ??
          state.activeToolParams.values().next().value;
        return error("UnclosedPart", { type: "block", id: unclosed });
      }
      const finish = state.pendingTerminal.part;
      const reason = finishReasonToAiSdk(finish.reason, finish.metadata);
      const response = encodeResponse(finish.response);
      return Effect.succeed([
        state,
        [
          ...companion("finish", finish.metadata, response === undefined ? {} : { response }),
          unsafePart({
            type: "finish",
            ...reason,
            totalUsage: usageToAiSdk(finish.usage),
          }),
        ],
      ]);
    }
    if (state.lastPartWasError) return Effect.succeed([state, []]);
    return error("MissingTerminal", { type: "stream" });
  }

  if (state.pendingTerminal?.type === "abort") return error("PartAfterTerminal", part);
  if (state.pendingTerminal?.type === "finish" && part.type === "finish") {
    return error("DuplicateTerminal", part);
  }
  if (
    state.pendingTerminal?.type === "finish" &&
    part.type !== "text-end" &&
    part.type !== "reasoning-end" &&
    part.type !== "tool-params-end"
  ) {
    return error("PartAfterTerminal", part);
  }

  if (part.type !== "error") state = { ...state, lastPartWasError: false };
  const metadata = providerMetadata(part.metadata);
  switch (part.type) {
    case "text-start":
      if (state.activeText.has(part.id)) return error("DuplicateStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeText", part.id, true),
        [{ type: "text-start", id: part.id, providerMetadata: metadata }],
      ]);
    case "text-delta":
      if (!state.activeText.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        state,
        [{ type: "text-delta", id: part.id, text: part.delta, providerMetadata: metadata }],
      ]);
    case "text-end":
      if (!state.activeText.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeText", part.id, false),
        [{ type: "text-end", id: part.id, providerMetadata: metadata }],
      ]);
    case "reasoning-start":
      if (state.activeReasoning.has(part.id)) return error("DuplicateStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeReasoning", part.id, true),
        [{ type: "reasoning-start", id: part.id, providerMetadata: metadata }],
      ]);
    case "reasoning-delta":
      if (!state.activeReasoning.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        state,
        [{ type: "reasoning-delta", id: part.id, text: part.delta, providerMetadata: metadata }],
      ]);
    case "reasoning-end":
      if (!state.activeReasoning.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeReasoning", part.id, false),
        [{ type: "reasoning-end", id: part.id, providerMetadata: metadata }],
      ]);
    case "tool-params-start":
      if (state.activeToolParams.has(part.id)) return error("DuplicateStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeToolParams", part.id, true),
        [
          unsafePart({
            type: "tool-input-start",
            id: part.id,
            toolName: part.name,
            providerExecuted: part.providerExecuted,
            dynamic: true,
            providerMetadata: metadata,
            ...(typeof aiSdkPartMetadata(part.metadata).title === "string"
              ? { title: aiSdkPartMetadata(part.metadata).title }
              : {}),
            ...(jsonObject(aiSdkPartMetadata(part.metadata).toolMetadata) === undefined
              ? {}
              : { toolMetadata: jsonObject(aiSdkPartMetadata(part.metadata).toolMetadata) }),
          }),
        ],
      ]);
    case "tool-params-delta":
      if (!state.activeToolParams.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        state,
        [{ type: "tool-input-delta", id: part.id, delta: part.delta, providerMetadata: metadata }],
      ]);
    case "tool-params-end":
      if (!state.activeToolParams.has(part.id)) return error("MissingStart", part);
      return Effect.succeed([
        stateWithSet(state, "activeToolParams", part.id, false),
        [{ type: "tool-input-end", id: part.id, providerMetadata: metadata }],
      ]);
    case "tool-call": {
      if (state.toolCalls.has(part.id)) return error("DuplicateToolCall", part);
      const call = toolCallFromPart(part);
      return Effect.succeed([
        { ...state, toolCalls: new Map(state.toolCalls).set(part.id, call) },
        [call],
      ]);
    }
    case "tool-result": {
      const call = state.toolCalls.get(part.id);
      if (call === undefined) return error("MissingToolCall", part);
      if (call.toolName !== part.name) return error("ToolNameMismatch", part);
      const details = aiSdkPartMetadata(part.metadata);
      const base = {
        toolCallId: part.id,
        toolName: part.name,
        input: call.input,
        dynamic: true as const,
        providerExecuted: part.providerExecuted,
        providerMetadata: metadata,
        preliminary: part.preliminary,
        ...(typeof details.title === "string" ? { title: details.title } : {}),
        ...(jsonObject(details.toolMetadata) === undefined
          ? {}
          : { toolMetadata: jsonObject(details.toolMetadata) }),
      };
      if (part.isFailure) {
        const denied =
          (isRecord(part.encodedResult) && part.encodedResult.type === "execution-denied") ||
          (isRecord(part.encodedResult) && part.encodedResult.denied === true) ||
          aiSdkPartMetadata(part.metadata).type === "tool-output-denied";
        if (denied) {
          return Effect.succeed([
            state,
            [
              ...companion("tool-output-denied", part.metadata),
              unsafePart({
                type: "tool-output-denied",
                toolCallId: part.id,
                toolName: part.name,
                dynamic: true,
                providerExecuted: part.providerExecuted,
              }),
            ],
          ]);
        }
        const { preliminary: _preliminary, ...errorBase } = base;
        return Effect.succeed([
          { ...state, lastPartWasError: false },
          [unsafePart({ type: "tool-error", ...errorBase, error: part.encodedResult })],
        ]);
      }
      return Effect.succeed([
        { ...state, lastPartWasError: false },
        [unsafePart({ type: "tool-result", ...base, output: part.encodedResult })],
      ]);
    }
    case "tool-approval-request": {
      const call = state.toolCalls.get(part.toolCallId);
      if (call === undefined) return error("MissingToolCall", part);
      const details = aiSdkPartMetadata(part.metadata);
      return Effect.succeed([
        state,
        [
          ...companion("tool-approval-request", part.metadata),
          unsafePart({
            type: "tool-approval-request",
            approvalId: part.approvalId,
            toolCall: call,
            ...(typeof details.isAutomatic === "boolean"
              ? { isAutomatic: details.isAutomatic }
              : {}),
            ...(typeof details.signature === "string" ? { signature: details.signature } : {}),
          }),
        ],
      ]);
    }
    case "file": {
      const reasoning = aiSdkPartMetadata(part.metadata).type === "reasoning-file";
      return Effect.succeed([
        state,
        [
          unsafePart({
            type: reasoning ? "reasoning-file" : "file",
            file: new DefaultGeneratedFile({ data: part.data, mediaType: part.mediaType }),
            providerMetadata: metadata,
          }),
        ],
      ]);
    }
    case "source":
      return Effect.succeed([
        state,
        [
          unsafePart(
            part.sourceType === "url"
              ? {
                  type: "source",
                  sourceType: "url",
                  id: part.id,
                  url: part.url.toString(),
                  title: part.title,
                  providerMetadata: metadata,
                }
              : {
                  type: "source",
                  sourceType: "document",
                  id: part.id,
                  mediaType: part.mediaType,
                  title: part.title,
                  filename: part.fileName,
                  providerMetadata: metadata,
                },
          ),
        ],
      ]);
    case "response-metadata": {
      const request = encodeRequest(part.request);
      return Effect.succeed([
        state,
        [
          customPart("effect.response-metadata", part.metadata, {
            part: {
              type: "response-metadata",
              ...(part.id === undefined ? {} : { id: part.id }),
              ...(part.modelId === undefined ? {} : { modelId: part.modelId }),
              ...(part.timestamp === undefined
                ? {}
                : { timestamp: DateTime.formatIso(part.timestamp) }),
              ...(request === undefined ? {} : { request }),
            },
          }),
        ],
      ]);
    }
    case "finish":
      if (state.pendingTerminal !== undefined) return error("DuplicateTerminal", part);
      if (aiSdkPartMetadata(part.metadata).type === "abort") {
        const reason = aiSdkPartMetadata(part.metadata).reason;
        return Effect.succeed([
          {
            ...state,
            pendingTerminal: {
              type: "abort",
              reason: typeof reason === "string" ? reason : undefined,
              metadata: part.metadata,
            },
          },
          [],
        ]);
      }
      return Effect.succeed([{ ...state, pendingTerminal: { type: "finish", part } }, []]);
    case "error":
      return Effect.succeed([
        { ...state, lastPartWasError: true },
        [...companion("error", part.metadata), unsafePart({ type: "error", error: part.error })],
      ]);
  }
};

const initialState = (options?: ToAiSdkStreamOptions): ConversionState => ({
  activeText: new Set(),
  activeReasoning: new Set(),
  activeToolParams: new Set(),
  toolCalls: new Map(options?.initialToolCalls ?? []),
  pendingTerminal: undefined,
  lastPartWasError: false,
});

export const toAiSdkParts = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
  options?: ToAiSdkStreamOptions,
): Stream.Stream<AiSdkStreamPart, E | EffectToAiSdkStreamError, R> => {
  const mapped = Stream.concat(stream, Stream.succeed(endSentinel)).pipe(
    Stream.mapAccumEffect(() => initialState(options), convertPart),
  );
  return Stream.concat(Stream.succeed<AiSdkStreamPart>({ type: "start" }), mapped);
};

export const toAiSdkStream = <Tools extends Record<string, Tool.Any>, E, R>(
  stream: Stream.Stream<Response.StreamPart<Tools>, E, R>,
  options?: ToAiSdkStreamOptions,
): Effect.Effect<ReadableStream<AiSdkStreamPart>, never, R> =>
  Stream.toReadableStreamEffect(toAiSdkParts(stream, options));
