import type { ContentBlock, SessionUpdate, ToolKind } from "@agentclientprotocol/sdk";
import { Encoding, Result, Schema, Stream } from "effect";
import { Response } from "effect/unstable/ai";

type SegmentKind = "text" | "reasoning";

type AgentChunkUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
>;

type UsageUpdate = Extract<SessionUpdate, { sessionUpdate: "usage_update" }>;

type State = Readonly<{
  active: Readonly<Record<SegmentKind, string | undefined>>;
  buffers: Readonly<Record<SegmentKind, string>>;
  fallbackIndexes: Readonly<Record<SegmentKind, number>>;
  toolNames: ReadonlyMap<string, string>;
  usage: UsageUpdate | undefined;
}>;

const initialState = (): State => ({
  active: {
    text: undefined,
    reasoning: undefined,
  },
  buffers: {
    text: "",
    reasoning: "",
  },
  fallbackIndexes: {
    text: 0,
    reasoning: 0,
  },
  toolNames: new Map(),
  usage: undefined,
});

const streamEnd = Symbol("AcpStreamEnd");

const streamCompleteMetadata: Response.ProviderMetadata = {
  acp: {
    sessionUpdate: "stream_complete",
  },
};

const emptyUsage = (): typeof Response.Usage.Encoded => ({
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

const acpMetadata = (update: SessionUpdate): Response.ProviderMetadata => ({
  acp: decodeJson(update),
});

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

const finishMetadata = (update: UsageUpdate | undefined): Response.ProviderMetadata =>
  update === undefined ? streamCompleteMetadata : acpMetadata(update);

const metadataPart = (metadata: Response.ProviderMetadata): Response.PartEncoded => ({
  type: "response-metadata",
  metadata,
});

const finishPart = (update: UsageUpdate | undefined): Response.PartEncoded => ({
  type: "finish",
  reason: "unknown",
  usage:
    update === undefined
      ? emptyUsage()
      : {
          inputTokens: {
            uncached: undefined,
            total: update.used,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: undefined,
            text: undefined,
            reasoning: undefined,
          },
        },
  metadata: finishMetadata(update),
});

const segmentFinalPart = (
  kind: SegmentKind,
  text: string,
  metadata: Response.ProviderMetadata,
): Response.PartEncoded =>
  kind === "text"
    ? { type: "text", text, metadata }
    : { type: "reasoning", text, metadata };

const base64ToBytes = (data: string): Uint8Array | undefined =>
  Result.match(Encoding.decodeBase64(data), {
    onFailure: () => undefined,
    onSuccess: (bytes) => bytes,
  });

const filePartFromBase64 = (
  data: string,
  mediaType: string,
  metadata: Response.ProviderMetadata,
): ReadonlyArray<Response.PartEncoded> => {
  const bytes = base64ToBytes(data);
  return bytes === undefined
    ? [metadataPart(metadata)]
    : [
        {
          type: "file",
          mediaType,
          data,
          metadata,
        },
      ];
};

const contentBlockToParts = (
  content: ContentBlock,
  metadata: Response.ProviderMetadata,
): ReadonlyArray<Response.PartEncoded> => {
  switch (content.type) {
    case "image":
    case "audio":
      return filePartFromBase64(content.data, content.mimeType, metadata);
    case "resource":
      return "blob" in content.resource
        ? filePartFromBase64(
            content.resource.blob,
            content.resource.mimeType ?? "application/octet-stream",
            metadata,
          )
        : [metadataPart(metadata)];
    case "resource_link":
    case "text":
      return [metadataPart(metadata)];
  }
};

const programmaticToolName = (name: string | null | undefined): string | undefined => {
  const normalized = name?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
};

const inferToolName = (
  kind: ToolKind | null | undefined,
  title: string | null | undefined,
  fallback: string,
): string => {
  if (kind !== undefined && kind !== null) {
    return kind;
  }

  const normalized = (title ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : fallback;
};

const fallbackToolName = (toolCallId: string): string => {
  const normalized = toolCallId.replaceAll(/[^a-zA-Z0-9_]+/g, "_");
  return normalized.length > 0 ? `acp_tool_${normalized}` : "acp_tool";
};

const toolCallPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
  name: string,
  metadata: Response.ProviderMetadata,
): Response.PartEncoded => ({
  type: "tool-call",
  id: update.toolCallId,
  name,
  params:
    update.rawInput === undefined
      ? {
          title: update.title,
          kind: update.kind ?? null,
        }
      : update.rawInput,
  providerExecuted: true,
  metadata,
});

const toolResultPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  name: string,
  metadata: Response.ProviderMetadata,
): Response.PartEncoded => {
  const result = update.rawOutput ??
    update.content ??
    update.locations ?? {
      status: update.status ?? null,
    };

  return {
    type: "tool-result",
    id: update.toolCallId,
    name,
    isFailure: update.status === "failed",
    result,
    providerExecuted: true,
    preliminary: update.status !== "completed" && update.status !== "failed",
    metadata,
  };
};

const chunkKind = (update: AgentChunkUpdate): SegmentKind =>
  update.sessionUpdate === "agent_message_chunk" ? "text" : "reasoning";

const nextChunkId = (
  state: State,
  update: AgentChunkUpdate,
  kind: SegmentKind,
): readonly [State, string] => {
  if (update.messageId !== undefined && update.messageId !== null) {
    return [state, update.messageId];
  }

  const activeId = state.active[kind];
  if (activeId !== undefined) {
    return [state, activeId];
  }

  const index = state.fallbackIndexes[kind] + 1;
  const prefix = kind === "text" ? "acp-agent-message" : "acp-agent-thought";
  return [
    {
      ...state,
      fallbackIndexes: {
        ...state.fallbackIndexes,
        [kind]: index,
      },
    },
    `${prefix}-${index}`,
  ];
};

const closeSegment = (
  state: State,
  kind: SegmentKind,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<Response.PartEncoded>] => {
  if (state.active[kind] === undefined) {
    return [state, []];
  }

  return [
    {
      ...state,
      active: { ...state.active, [kind]: undefined },
      buffers: { ...state.buffers, [kind]: "" },
    },
    [segmentFinalPart(kind, state.buffers[kind], metadata)],
  ];
};

const handleAgentChunk = (
  state: State,
  update: AgentChunkUpdate,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<Response.PartEncoded>] => {
  const kind = chunkKind(update);
  if (update.content.type !== "text") {
    return [state, contentBlockToParts(update.content, metadata)];
  }

  const [stateWithId, id] = nextChunkId(state, update, kind);
  const activeId = stateWithId.active[kind];

  // A chunk for the active segment appends to its buffer; a chunk for a new
  // segment starts a fresh buffer and finalizes the previous one, if any.
  const continuing = activeId === id;
  const finalized: ReadonlyArray<Response.PartEncoded> =
    activeId !== undefined && !continuing
      ? [segmentFinalPart(kind, stateWithId.buffers[kind], metadata)]
      : [];

  return [
    {
      ...stateWithId,
      active: { ...stateWithId.active, [kind]: id },
      buffers: {
        ...stateWithId.buffers,
        [kind]: (continuing ? stateWithId.buffers[kind] : "") + update.content.text,
      },
    },
    finalized,
  ];
};

const handleToolCall = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<Response.PartEncoded>] => {
  const name =
    programmaticToolName(update.name) ?? inferToolName(update.kind, update.title, "acp_tool");
  const toolNames = new Map(state.toolNames);
  toolNames.set(update.toolCallId, name);
  return [
    {
      ...state,
      toolNames,
    },
    [toolCallPart(update, name, metadata)],
  ];
};

const handleToolCallUpdate = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
  metadata: Response.ProviderMetadata,
): readonly [State, ReadonlyArray<Response.PartEncoded>] => {
  const existingName = state.toolNames.get(update.toolCallId);
  const name =
    programmaticToolName(update.name) ??
    existingName ??
    inferToolName(update.kind, update.title, fallbackToolName(update.toolCallId));

  if (existingName === name) {
    return [state, [toolResultPart(update, name, metadata)]];
  }

  const toolNames = new Map(state.toolNames);
  toolNames.set(update.toolCallId, name);
  return [{ ...state, toolNames }, [toolResultPart(update, name, metadata)]];
};

const handleUpdate = (
  state: State,
  update: SessionUpdate,
): readonly [State, ReadonlyArray<Response.PartEncoded>] => {
  if (update.sessionUpdate === "usage_update") {
    return [{ ...state, usage: update }, []];
  }

  const metadata = acpMetadata(update);
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return handleAgentChunk(state, update, metadata);
    case "tool_call":
      return handleToolCall(state, update, metadata);
    case "tool_call_update":
      return handleToolCallUpdate(state, update, metadata);
    case "user_message_chunk":
    case "plan":
    case "plan_update":
    case "plan_removed":
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
      return [state, [metadataPart(metadata)]];
  }
};

const closeStream = (state: State): ReadonlyArray<Response.PartEncoded> => {
  const [stateWithoutText, textParts] = closeSegment(state, "text", streamCompleteMetadata);
  const [_closedState, reasoningParts] = closeSegment(
    stateWithoutText,
    "reasoning",
    streamCompleteMetadata,
  );
  return [...textParts, ...reasoningParts, finishPart(state.usage)];
};

const handleStreamEvent = (
  state: State,
  event: SessionUpdate | typeof streamEnd,
): readonly [State, ReadonlyArray<Response.PartEncoded>] =>
  event === streamEnd ? [state, closeStream(state)] : handleUpdate(state, event);

export const transform = <E, R>(
  stream: Stream.Stream<SessionUpdate, E, R>,
): Stream.Stream<Response.PartEncoded, E, R> =>
  stream.pipe(
    Stream.concat(Stream.succeed(streamEnd)),
    Stream.mapAccum(initialState, handleStreamEvent),
  );
