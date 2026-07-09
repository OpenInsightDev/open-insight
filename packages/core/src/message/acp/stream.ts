import type { ContentBlock, SessionUpdate, ToolKind } from "@agentclientprotocol/sdk";
import { Effect, Encoding, Result, Schema, Stream } from "effect";
import { Response, Tool } from "effect/unstable/ai";

export type AcpTools = Record<string, Tool.AnyDynamic>;
export type StreamPart = Response.StreamPart<AcpTools>;

type SegmentKind = "text" | "reasoning";

type State = Readonly<{
  active: Readonly<Record<SegmentKind, string | undefined>>;
  opened: Readonly<Record<SegmentKind, ReadonlySet<string>>>;
  fallbackIndexes: Readonly<Record<SegmentKind, number>>;
  toolNames: ReadonlyMap<string, string>;
  finished: boolean;
}>;

type AgentChunkUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
>;

const initialState: State = {
  active: {
    text: undefined,
    reasoning: undefined,
  },
  opened: {
    text: new Set(),
    reasoning: new Set(),
  },
  fallbackIndexes: {
    text: 0,
    reasoning: 0,
  },
  toolNames: new Map(),
  finished: false,
};

const streamCompleteMetadata: Response.ProviderMetadata = {
  acp: {
    sessionUpdate: "stream_complete",
  },
};

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

const acpMetadata = (update: SessionUpdate): Response.ProviderMetadata => ({
  acp: decodeJson(update),
});

const decodeJson = Schema.decodeUnknownSync(Schema.Json);

const metadataFor = (update: SessionUpdate | undefined): Response.ProviderMetadata =>
  update === undefined ? streamCompleteMetadata : acpMetadata(update);

const metadataPart = (update: SessionUpdate): StreamPart =>
  Response.makePart("response-metadata", {
    id: undefined,
    modelId: undefined,
    timestamp: undefined,
    request: undefined,
    metadata: acpMetadata(update),
  });

const finishPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }> | undefined,
): StreamPart =>
  Response.makePart("finish", {
    reason: "unknown",
    usage:
      update === undefined
        ? emptyUsage()
        : new Response.Usage({
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
          }),
    response: undefined,
    metadata: metadataFor(update),
  });

const segmentStartPart = (kind: SegmentKind, id: string, update: SessionUpdate): StreamPart =>
  kind === "text"
    ? Response.makePart("text-start", { id, metadata: acpMetadata(update) })
    : Response.makePart("reasoning-start", { id, metadata: acpMetadata(update) });

const segmentDeltaPart = (
  kind: SegmentKind,
  id: string,
  delta: string,
  update: SessionUpdate,
): StreamPart =>
  kind === "text"
    ? Response.makePart("text-delta", { id, delta, metadata: acpMetadata(update) })
    : Response.makePart("reasoning-delta", { id, delta, metadata: acpMetadata(update) });

const segmentEndPart = (
  kind: SegmentKind,
  id: string,
  update: SessionUpdate | undefined,
): StreamPart =>
  kind === "text"
    ? Response.makePart("text-end", { id, metadata: metadataFor(update) })
    : Response.makePart("reasoning-end", { id, metadata: metadataFor(update) });

const base64ToBytes = (data: string): Uint8Array | undefined => {
  const result = Encoding.decodeBase64(data);
  return Result.isSuccess(result) ? result.success : undefined;
};

const filePartFromBase64 = (
  data: string,
  mediaType: string,
  update: SessionUpdate,
): ReadonlyArray<StreamPart> => {
  const bytes = base64ToBytes(data);
  return bytes === undefined
    ? [metadataPart(update)]
    : [
        Response.makePart("file", {
          mediaType,
          data: bytes,
          metadata: acpMetadata(update),
        }),
      ];
};

const contentBlockToParts = (
  content: ContentBlock,
  update: SessionUpdate,
): ReadonlyArray<StreamPart> => {
  switch (content.type) {
    case "image":
    case "audio":
      return filePartFromBase64(content.data, content.mimeType, update);
    case "resource":
      return "blob" in content.resource
        ? filePartFromBase64(
            content.resource.blob,
            content.resource.mimeType ?? "application/octet-stream",
            update,
          )
        : [metadataPart(update)];
    case "resource_link":
    case "text":
      return [metadataPart(update)];
  }
};

const normalizeToolName = (kind: ToolKind | undefined, title: string): string => {
  if (kind !== undefined) {
    return kind;
  }

  const normalized = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "acp_tool";
};

const fallbackToolName = (toolCallId: string): string =>
  `acp_tool_${toolCallId.replaceAll(/[^a-zA-Z0-9_]+/g, "_")}`;

const toolCallPart = (
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
): StreamPart => {
  const name = normalizeToolName(update.kind, update.title);
  return Response.toolCallPart({
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
    metadata: acpMetadata(update),
  });
};

const toolResultPart = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>,
): StreamPart => {
  const result = update.rawOutput ??
    update.content ??
    update.locations ?? {
      status: update.status ?? null,
    };

  return Response.toolResultPart({
    id: update.toolCallId,
    name: state.toolNames.get(update.toolCallId) ?? fallbackToolName(update.toolCallId),
    isFailure: update.status === "failed",
    result,
    encodedResult: result,
    providerExecuted: true,
    preliminary: update.status !== "completed" && update.status !== "failed",
    metadata: acpMetadata(update),
  });
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

const setActiveSegment = (state: State, kind: SegmentKind, id: string | undefined): State => ({
  ...state,
  active: {
    ...state.active,
    [kind]: id,
  },
});

const markSegmentOpened = (state: State, kind: SegmentKind, id: string): State => ({
  ...state,
  opened: {
    ...state.opened,
    [kind]: new Set([...state.opened[kind], id]),
  },
});

const closeSegment = (
  state: State,
  kind: SegmentKind,
  update: SessionUpdate | undefined,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const activeId = state.active[kind];
  if (activeId === undefined) {
    return [state, []];
  }

  return [setActiveSegment(state, kind, undefined), [segmentEndPart(kind, activeId, update)]];
};

const closeChangedSegment = (
  state: State,
  kind: SegmentKind,
  id: string,
  update: SessionUpdate,
): readonly [State, ReadonlyArray<StreamPart>] =>
  state.active[kind] === undefined || state.active[kind] === id
    ? [state, []]
    : closeSegment(state, kind, update);

const handleAgentChunk = (
  state: State,
  update: AgentChunkUpdate,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const kind = chunkKind(update);
  if (update.content.type !== "text") {
    return [state, contentBlockToParts(update.content, update)];
  }

  const [stateWithId, id] = nextChunkId(state, update, kind);
  const [stateWithClosedSegment, closedParts] = closeChangedSegment(stateWithId, kind, id, update);

  const opened = stateWithClosedSegment.opened[kind].has(id);
  const nextState = setActiveSegment(
    opened ? stateWithClosedSegment : markSegmentOpened(stateWithClosedSegment, kind, id),
    kind,
    id,
  );

  return [
    nextState,
    [
      ...closedParts,
      ...(opened ? [] : [segmentStartPart(kind, id, update)]),
      segmentDeltaPart(kind, id, update.content.text, update),
    ],
  ];
};

const handleToolCall = (
  state: State,
  update: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>,
): readonly [State, ReadonlyArray<StreamPart>] => {
  const name = normalizeToolName(update.kind, update.title);
  return [
    {
      ...state,
      toolNames: new Map([...state.toolNames, [update.toolCallId, name]]),
    },
    [toolCallPart(update)],
  ];
};

const handleUpdate = (
  state: State,
  update: SessionUpdate,
): readonly [State, ReadonlyArray<StreamPart>] => {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return handleAgentChunk(state, update);
    case "tool_call":
      return handleToolCall(state, update);
    case "tool_call_update":
      return [state, [toolResultPart(state, update)]];
    case "usage_update":
      return [{ ...state, finished: true }, [finishPart(update)]];
    case "user_message_chunk":
    case "plan":
    case "plan_update":
    case "plan_removed":
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
      return [state, [metadataPart(update)]];
  }
};

const closeStream = (state: State): ReadonlyArray<StreamPart> => {
  const [stateWithoutText, textParts] = closeSegment(state, "text", undefined);
  const [_closedState, reasoningParts] = closeSegment(stateWithoutText, "reasoning", undefined);
  return state.finished
    ? [...textParts, ...reasoningParts]
    : [...textParts, ...reasoningParts, finishPart(undefined)];
};

export const transform = Effect.fn(function* <E, R>(
  stream: Stream.Stream<SessionUpdate, E, R>,
): Effect.fn.Return<Stream.Stream<StreamPart, E, R>> {
  return yield* Effect.succeed(
    stream.pipe(
      Stream.mapAccum(() => initialState, handleUpdate, {
        onHalt: closeStream,
      }),
    ),
  );
}, Stream.unwrap);
