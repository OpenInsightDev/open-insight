import type { Response, Tool } from "effect/unstable/ai";

interface StreamingPartBase {
  metadata?: Record<string, unknown>;
}

interface StreamingTextStartPart extends StreamingPartBase {
  type: "text-start";
  id: string;
}

interface StreamingTextDeltaPart extends StreamingPartBase {
  type: "text-delta";
  id: string;
  delta: string;
}

interface StreamingTextEndPart extends StreamingPartBase {
  type: "text-end";
  id: string;
}

interface StreamingReasoningStartPart extends StreamingPartBase {
  type: "reasoning-start";
  id: string;
}

interface StreamingReasoningDeltaPart extends StreamingPartBase {
  type: "reasoning-delta";
  id: string;
  delta: string;
}

interface StreamingReasoningEndPart extends StreamingPartBase {
  type: "reasoning-end";
  id: string;
}

interface StreamingToolParamsStartPart extends StreamingPartBase {
  type: "tool-params-start";
  id: string;
  name: string;
  providerExecuted?: boolean;
}

interface StreamingToolParamsDeltaPart extends StreamingPartBase {
  type: "tool-params-delta";
  id: string;
  delta: string;
}

interface StreamingToolParamsEndPart extends StreamingPartBase {
  type: "tool-params-end";
  id: string;
}

interface StreamingToolCallPart extends StreamingPartBase {
  type: "tool-call";
  id: string;
  name: string;
  params: unknown;
  providerExecuted?: boolean;
}

interface StreamingToolResultPart extends StreamingPartBase {
  type: "tool-result";
  id: string;
  name: string;
  result: unknown;
  encodedResult?: unknown;
  isFailure: boolean;
  providerExecuted?: boolean;
  preliminary?: boolean;
}

interface StreamingToolApprovalRequestPart extends StreamingPartBase {
  type: "tool-approval-request";
  approvalId: string;
  toolCallId: string;
}

interface StreamingFilePart extends StreamingPartBase {
  type: "file";
  mediaType: string;
  data: unknown;
}

interface StreamingDocumentSourcePart extends StreamingPartBase {
  type: "source";
  sourceType: "document";
  id: string;
  title: string;
  mediaType: string;
  fileName?: string;
}

interface StreamingUrlSourcePart extends StreamingPartBase {
  type: "source";
  sourceType: "url";
  id: string;
  title: string;
  url: string;
}

interface StreamingResponseMetadataPart extends StreamingPartBase {
  type: "response-metadata";
  id?: string;
  modelId?: string;
  timestamp?: unknown;
  request?: unknown;
}

interface StreamingFinishPart extends StreamingPartBase {
  type: "finish";
  reason:
    | "stop"
    | "length"
    | "content-filter"
    | "tool-calls"
    | "error"
    | "pause"
    | "other"
    | "unknown";
  usage?: unknown;
  response?: unknown;
}

interface StreamingErrorPart extends StreamingPartBase {
  type: "error";
  error: unknown;
}

export type StreamingMessagePartEncoded =
  | StreamingTextStartPart
  | StreamingTextDeltaPart
  | StreamingTextEndPart
  | StreamingReasoningStartPart
  | StreamingReasoningDeltaPart
  | StreamingReasoningEndPart
  | StreamingToolParamsStartPart
  | StreamingToolParamsDeltaPart
  | StreamingToolParamsEndPart
  | StreamingToolCallPart
  | StreamingToolResultPart
  | StreamingToolApprovalRequestPart
  | StreamingFilePart
  | StreamingDocumentSourcePart
  | StreamingUrlSourcePart
  | StreamingResponseMetadataPart
  | StreamingFinishPart
  | StreamingErrorPart;

export type StreamingMessagePart =
  | StreamingMessagePartEncoded
  | Response.StreamPart<Record<string, Tool.Any>>;

export type StreamingSegmentStatus =
  | "streaming"
  | "complete"
  | "ready"
  | "preliminary"
  | "approval-required"
  | "failed";

export type StreamingContentKind = "text" | "reasoning";

export interface StreamingTextSegment {
  kind: StreamingContentKind;
  id: string;
  text: string;
  status: Extract<StreamingSegmentStatus, "streaming" | "complete">;
  partIndexes: Array<number>;
}

export interface StreamingToolSegment {
  kind: "tool";
  id: string;
  name: string;
  providerExecuted: boolean;
  paramsText: string;
  params?: unknown;
  result?: unknown;
  encodedResult?: unknown;
  isFailure?: boolean;
  approvalId?: string;
  status: StreamingSegmentStatus;
  partIndexes: Array<number>;
}

export interface StreamingAttachmentSegment {
  kind: "attachment";
  id: string;
  mediaType: string;
  byteLength: number;
  partIndexes: Array<number>;
}

export type StreamingSourceSegment =
  | {
      kind: "source";
      sourceType: "document";
      id: string;
      title: string;
      mediaType: string;
      fileName?: string;
      partIndexes: Array<number>;
    }
  | {
      kind: "source";
      sourceType: "url";
      id: string;
      title: string;
      url: string;
      partIndexes: Array<number>;
    };

export interface StreamingErrorSegment {
  kind: "error";
  id: string;
  error: unknown;
  partIndexes: Array<number>;
}

export type StreamingMessageSegment =
  | StreamingTextSegment
  | StreamingToolSegment
  | StreamingAttachmentSegment
  | StreamingSourceSegment
  | StreamingErrorSegment;

export interface StreamingMessageView {
  id: string;
  text: string;
  reasoning: string;
  status: StreamingSegmentStatus;
  partCount: number;
  tools: Array<StreamingToolSegment>;
  attachments: Array<StreamingAttachmentSegment>;
  sources: Array<StreamingSourceSegment>;
  errors: Array<StreamingErrorSegment>;
}

export interface StreamingMessageModel {
  message: StreamingMessageView;
  debugSegments: Array<StreamingMessageSegment>;
}

type MutableTextSegment = StreamingTextSegment;
type MutableToolSegment = StreamingToolSegment;

const fallbackId = (type: string, index: number): string => `${type}-${index}`;

const fallbackString = (value: string, fallback: string): string =>
  value.length > 0 ? value : fallback;

const byteLengthOf = (value: unknown): number => {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }

  if (typeof value === "string") {
    return value.length;
  }

  if (typeof value === "object" && value !== null && "byteLength" in value) {
    const byteLength = value.byteLength;
    if (typeof byteLength === "number" && Number.isFinite(byteLength)) {
      return byteLength;
    }
  }

  return 0;
};

const urlString = (value: string | URL): string => (typeof value === "string" ? value : value.href);

const ensureTextSegment = (
  segments: Array<StreamingMessageSegment>,
  byId: Map<string, MutableTextSegment>,
  kind: StreamingContentKind,
  id: string,
): MutableTextSegment => {
  const existing = byId.get(id);
  if (existing !== undefined) {
    return existing;
  }

  const segment: MutableTextSegment = {
    kind,
    id,
    text: "",
    status: "streaming",
    partIndexes: [],
  };
  byId.set(id, segment);
  segments.push(segment);
  return segment;
};

const ensureToolSegment = (
  segments: Array<StreamingMessageSegment>,
  byId: Map<string, MutableToolSegment>,
  id: string,
  name: string,
  providerExecuted: boolean,
): MutableToolSegment => {
  const existing = byId.get(id);
  if (existing !== undefined) {
    if (existing.name.length === 0 && name.length > 0) {
      existing.name = name;
    }
    existing.providerExecuted = existing.providerExecuted || providerExecuted;
    return existing;
  }

  const segment: MutableToolSegment = {
    kind: "tool",
    id,
    name,
    providerExecuted,
    paramsText: "",
    status: "streaming",
    partIndexes: [],
  };
  byId.set(id, segment);
  segments.push(segment);
  return segment;
};

const segmentStatus = (segment: StreamingMessageSegment): StreamingSegmentStatus => {
  switch (segment.kind) {
    case "text":
    case "reasoning":
    case "tool":
      return segment.status;
    case "error":
      return "failed";
    case "attachment":
    case "source":
      return "complete";
  }
};

const messageStatus = (
  segments: ReadonlyArray<StreamingMessageSegment>,
  sawFinish: boolean,
): StreamingSegmentStatus => {
  if (segments.some((segment) => segmentStatus(segment) === "failed")) {
    return "failed";
  }

  if (segments.some((segment) => segmentStatus(segment) === "approval-required")) {
    return "approval-required";
  }

  if (segments.some((segment) => segmentStatus(segment) === "streaming")) {
    return "streaming";
  }

  if (segments.some((segment) => segmentStatus(segment) === "preliminary")) {
    return "preliminary";
  }

  if (segments.some((segment) => segmentStatus(segment) === "ready")) {
    return "ready";
  }

  return sawFinish || segments.length > 0 ? "complete" : "ready";
};

const joinSegmentText = (segments: ReadonlyArray<StreamingTextSegment>): string =>
  segments
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

const toolResultEncodedValue = (part: Extract<StreamingMessagePart, { type: "tool-result" }>) =>
  "encodedResult" in part ? part.encodedResult : undefined;

export const buildStreamingMessageModel = (
  parts: ReadonlyArray<StreamingMessagePart>,
): StreamingMessageModel => {
  const segments: Array<StreamingMessageSegment> = [];
  const textSegments: Array<MutableTextSegment> = [];
  const reasoningSegments: Array<MutableTextSegment> = [];
  const toolSegments: Array<MutableToolSegment> = [];
  const attachmentSegments: Array<StreamingAttachmentSegment> = [];
  const sourceSegments: Array<StreamingSourceSegment> = [];
  const errorSegments: Array<StreamingErrorSegment> = [];
  const textById = new Map<string, MutableTextSegment>();
  const reasoningById = new Map<string, MutableTextSegment>();
  const toolById = new Map<string, MutableToolSegment>();
  let sawFinish = false;

  parts.forEach((part, index) => {
    switch (part.type) {
      case "text-start": {
        const segment = ensureTextSegment(
          segments,
          textById,
          "text",
          fallbackString(part.id, fallbackId("text", index)),
        );
        if (!textSegments.includes(segment)) {
          textSegments.push(segment);
        }
        segment.partIndexes.push(index);
        segment.status = "streaming";
        return;
      }
      case "text-delta": {
        const segment = ensureTextSegment(
          segments,
          textById,
          "text",
          fallbackString(part.id, fallbackId("text", index)),
        );
        if (!textSegments.includes(segment)) {
          textSegments.push(segment);
        }
        segment.text += part.delta;
        segment.partIndexes.push(index);
        return;
      }
      case "text-end": {
        const segment = ensureTextSegment(
          segments,
          textById,
          "text",
          fallbackString(part.id, fallbackId("text", index)),
        );
        if (!textSegments.includes(segment)) {
          textSegments.push(segment);
        }
        segment.partIndexes.push(index);
        segment.status = "complete";
        return;
      }
      case "reasoning-start": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          fallbackString(part.id, fallbackId("reasoning", index)),
        );
        if (!reasoningSegments.includes(segment)) {
          reasoningSegments.push(segment);
        }
        segment.partIndexes.push(index);
        segment.status = "streaming";
        return;
      }
      case "reasoning-delta": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          fallbackString(part.id, fallbackId("reasoning", index)),
        );
        if (!reasoningSegments.includes(segment)) {
          reasoningSegments.push(segment);
        }
        segment.text += part.delta;
        segment.partIndexes.push(index);
        return;
      }
      case "reasoning-end": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          fallbackString(part.id, fallbackId("reasoning", index)),
        );
        if (!reasoningSegments.includes(segment)) {
          reasoningSegments.push(segment);
        }
        segment.partIndexes.push(index);
        segment.status = "complete";
        return;
      }
      case "tool-params-start": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.id, fallbackId("tool", index)),
          part.name,
          part.providerExecuted ?? false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.status = "streaming";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-params-delta": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.id, fallbackId("tool", index)),
          "",
          false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.paramsText += part.delta;
        segment.partIndexes.push(index);
        return;
      }
      case "tool-params-end": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.id, fallbackId("tool", index)),
          "",
          false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.status = "ready";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-call": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.id, fallbackId("tool", index)),
          part.name,
          part.providerExecuted ?? false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.params = part.params;
        segment.status = "ready";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-result": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.id, fallbackId("tool", index)),
          part.name,
          part.providerExecuted ?? false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.result = part.result;
        segment.encodedResult = toolResultEncodedValue(part);
        segment.isFailure = part.isFailure;
        segment.status = part.isFailure ? "failed" : part.preliminary ? "preliminary" : "complete";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-approval-request": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          fallbackString(part.toolCallId, fallbackId("tool", index)),
          "",
          false,
        );
        if (!toolSegments.includes(segment)) {
          toolSegments.push(segment);
        }
        segment.approvalId = part.approvalId;
        segment.status = "approval-required";
        segment.partIndexes.push(index);
        return;
      }
      case "file": {
        const segment: StreamingAttachmentSegment = {
          kind: "attachment",
          id: fallbackId("file", index),
          mediaType: part.mediaType,
          byteLength: byteLengthOf(part.data),
          partIndexes: [index],
        };
        attachmentSegments.push(segment);
        segments.push(segment);
        return;
      }
      case "source": {
        const segment: StreamingSourceSegment =
          part.sourceType === "document"
            ? {
                kind: "source",
                sourceType: "document",
                id: fallbackString(part.id, fallbackId("source", index)),
                title: part.title,
                mediaType: part.mediaType,
                fileName: part.fileName,
                partIndexes: [index],
              }
            : {
                kind: "source",
                sourceType: "url",
                id: fallbackString(part.id, fallbackId("source", index)),
                title: part.title,
                url: urlString(part.url),
                partIndexes: [index],
              };
        sourceSegments.push(segment);
        segments.push(segment);
        return;
      }
      case "response-metadata":
        return;
      case "finish":
        sawFinish = true;
        return;
      case "error": {
        const segment: StreamingErrorSegment = {
          kind: "error",
          id: fallbackId("error", index),
          error: part.error,
          partIndexes: [index],
        };
        errorSegments.push(segment);
        segments.push(segment);
        return;
      }
    }
  });

  if (sawFinish) {
    for (const segment of textSegments) {
      if (segment.status === "streaming") {
        segment.status = "complete";
      }
    }
    for (const segment of reasoningSegments) {
      if (segment.status === "streaming") {
        segment.status = "complete";
      }
    }
    for (const segment of toolSegments) {
      if (segment.status === "streaming") {
        segment.status = "ready";
      }
    }
  }

  return {
    message: {
      id: "assistant",
      text: joinSegmentText(textSegments),
      reasoning: joinSegmentText(reasoningSegments),
      status: messageStatus(segments, sawFinish),
      partCount: parts.length,
      tools: toolSegments,
      attachments: attachmentSegments,
      sources: sourceSegments,
      errors: errorSegments,
    },
    debugSegments: segments,
  };
};

export const formatStreamingValue = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
};

export const summarizeStreamingSegment = (segment: StreamingMessageSegment): string => {
  switch (segment.kind) {
    case "text":
      return segment.text.length > 0 ? segment.text : "Waiting for text";
    case "reasoning":
      return segment.text.length > 0 ? segment.text : "Waiting for reasoning";
    case "tool":
      return segment.name.length > 0 ? segment.name : segment.id;
    case "attachment":
      return `${segment.mediaType} · ${segment.byteLength} bytes`;
    case "source":
      return segment.title;
    case "error":
      return formatStreamingValue(segment.error);
  }
};
