import type { Response, Tool } from "effect/unstable/ai";

export type StreamingMessagePart = Response.StreamPart<Record<string, Tool.Any>>;
export type StreamingKnownMessagePart = StreamingMessagePart | Response.StreamPartEncoded;
export type StreamingMessagePartInput = unknown;

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

type MutableTextSegment = StreamingTextSegment;
type MutableToolSegment = StreamingToolSegment;

const fallbackId = (type: string, index: number): string => `${type}-${index}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const booleanField = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const streamId = (record: Record<string, unknown>, fallback: string): string =>
  stringField(record, "id") ?? fallback;

const streamName = (record: Record<string, unknown>): string => stringField(record, "name") ?? "";

const byteLengthOf = (value: unknown): number => {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }

  if (typeof value === "string") {
    return value.length;
  }

  if (isRecord(value)) {
    const byteLength = value.byteLength;
    if (typeof byteLength === "number" && Number.isFinite(byteLength)) {
      return byteLength;
    }
  }

  return 0;
};

const urlString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof URL) {
    return value.href;
  }

  return "unknown url";
};

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

export const buildStreamingMessageSegments = (
  parts: ReadonlyArray<StreamingMessagePartInput>,
): Array<StreamingMessageSegment> => {
  const segments: Array<StreamingMessageSegment> = [];
  const textById = new Map<string, MutableTextSegment>();
  const reasoningById = new Map<string, MutableTextSegment>();
  const toolById = new Map<string, MutableToolSegment>();
  let sawFinish = false;

  parts.forEach((part, index) => {
    if (!isRecord(part)) {
      return;
    }

    const type = stringField(part, "type");

    switch (type) {
      case "text-start": {
        const segment = ensureTextSegment(segments, textById, "text", streamId(part, "text"));
        segment.partIndexes.push(index);
        segment.status = "streaming";
        return;
      }
      case "text-delta": {
        const segment = ensureTextSegment(segments, textById, "text", streamId(part, "text"));
        segment.text += stringField(part, "delta") ?? "";
        segment.partIndexes.push(index);
        return;
      }
      case "text-end": {
        const segment = ensureTextSegment(segments, textById, "text", streamId(part, "text"));
        segment.partIndexes.push(index);
        segment.status = "complete";
        return;
      }
      case "reasoning-start": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          streamId(part, "reasoning"),
        );
        segment.partIndexes.push(index);
        segment.status = "streaming";
        return;
      }
      case "reasoning-delta": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          streamId(part, "reasoning"),
        );
        segment.text += stringField(part, "delta") ?? "";
        segment.partIndexes.push(index);
        return;
      }
      case "reasoning-end": {
        const segment = ensureTextSegment(
          segments,
          reasoningById,
          "reasoning",
          streamId(part, "reasoning"),
        );
        segment.partIndexes.push(index);
        segment.status = "complete";
        return;
      }
      case "tool-params-start": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          streamId(part, fallbackId("tool", index)),
          streamName(part),
          booleanField(part, "providerExecuted") ?? false,
        );
        segment.status = "streaming";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-params-delta": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          streamId(part, fallbackId("tool", index)),
          "",
          false,
        );
        segment.paramsText += stringField(part, "delta") ?? "";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-params-end": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          streamId(part, fallbackId("tool", index)),
          "",
          false,
        );
        segment.status = "ready";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-call": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          streamId(part, fallbackId("tool", index)),
          streamName(part),
          booleanField(part, "providerExecuted") ?? false,
        );
        segment.params = part.params;
        segment.status = "ready";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-result": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          streamId(part, fallbackId("tool", index)),
          streamName(part),
          booleanField(part, "providerExecuted") ?? false,
        );
        segment.result = part.result;
        segment.encodedResult = part.encodedResult;
        segment.isFailure = booleanField(part, "isFailure") ?? false;
        segment.status = segment.isFailure
          ? "failed"
          : booleanField(part, "preliminary") === true
            ? "preliminary"
            : "complete";
        segment.partIndexes.push(index);
        return;
      }
      case "tool-approval-request": {
        const segment = ensureToolSegment(
          segments,
          toolById,
          stringField(part, "toolCallId") ?? fallbackId("tool", index),
          "",
          false,
        );
        segment.approvalId = stringField(part, "approvalId");
        segment.status = "approval-required";
        segment.partIndexes.push(index);
        return;
      }
      case "file":
        segments.push({
          kind: "attachment",
          id: fallbackId("file", index),
          mediaType: stringField(part, "mediaType") ?? "application/octet-stream",
          byteLength: byteLengthOf(part.data),
          partIndexes: [index],
        });
        return;
      case "source":
        if (stringField(part, "sourceType") === "document") {
          segments.push({
            kind: "source",
            sourceType: "document",
            id: streamId(part, fallbackId("source", index)),
            title: stringField(part, "title") ?? "Document source",
            mediaType: stringField(part, "mediaType") ?? "application/octet-stream",
            fileName: stringField(part, "fileName"),
            partIndexes: [index],
          });
          return;
        }

        segments.push({
          kind: "source",
          sourceType: "url",
          id: streamId(part, fallbackId("source", index)),
          title: stringField(part, "title") ?? "URL source",
          url: urlString(part.url),
          partIndexes: [index],
        });
        return;
      case "response-metadata":
        return;
      case "finish":
        sawFinish = true;
        return;
      case "error":
        segments.push({
          kind: "error",
          id: fallbackId("error", index),
          error: part.error,
          partIndexes: [index],
        });
        return;
    }
  });

  if (sawFinish) {
    for (const segment of textById.values()) {
      if (segment.status === "streaming") {
        segment.status = "complete";
      }
    }
    for (const segment of reasoningById.values()) {
      if (segment.status === "streaming") {
        segment.status = "complete";
      }
    }
    for (const segment of toolById.values()) {
      if (segment.status === "streaming") {
        segment.status = "ready";
      }
    }
  }

  return segments;
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

  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? "[unserializable]";
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
