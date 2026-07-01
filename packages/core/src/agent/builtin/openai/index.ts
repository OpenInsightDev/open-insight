import { Effect, Stream, DateTime, Predicate } from "effect";
import * as Response from "effect/unstable/ai/Response";
import * as Tool from "effect/unstable/ai/Tool";
import { OpenAiSchema } from "@effect/ai-openai";

// =============================================================================
// Types
// =============================================================================

export type ResponseStreamEvent = OpenAiSchema.ResponseStreamEvent;

type KnownResponseStreamEventType =
  | "response.created"
  | "response.completed"
  | "response.incomplete"
  | "response.failed"
  | "response.output_item.added"
  | "response.output_item.done"
  | "response.output_text.delta"
  | "response.output_text.annotation.added"
  | "response.reasoning_summary_part.added"
  | "response.reasoning_summary_part.done"
  | "response.reasoning_summary_text.delta"
  | "response.function_call_arguments.delta"
  | "response.function_call_arguments.done"
  | "response.code_interpreter_call_code.delta"
  | "response.code_interpreter_call_code.done"
  | "response.apply_patch_call_operation_diff.delta"
  | "response.apply_patch_call_operation_diff.done"
  | "response.image_generation_call.partial_image"
  | "error";

type KnownResponseStreamEvent = Extract<
  ResponseStreamEvent,
  { readonly type: KnownResponseStreamEventType }
>;

const knownResponseStreamEventTypes = new Set<KnownResponseStreamEventType>([
  "response.created",
  "response.completed",
  "response.incomplete",
  "response.failed",
  "response.output_item.added",
  "response.output_item.done",
  "response.output_text.delta",
  "response.output_text.annotation.added",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.code_interpreter_call_code.delta",
  "response.code_interpreter_call_code.done",
  "response.apply_patch_call_operation_diff.delta",
  "response.apply_patch_call_operation_diff.done",
  "response.image_generation_call.partial_image",
  "error",
]);

const isKnownResponseStreamEvent = (
  event: ResponseStreamEvent,
): event is KnownResponseStreamEvent =>
  knownResponseStreamEventTypes.has(event.type as KnownResponseStreamEventType);

// =============================================================================
// Utilities
// =============================================================================

const finishReasonMap: Record<string, Response.FinishReason> = {
  content_filter: "content-filter",
  function_call: "tool-calls",
  length: "length",
  stop: "stop",
  tool_calls: "tool-calls",
};

const resolveFinishReason = (
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
): Response.FinishReason => {
  if (finishReason == null) {
    return hasToolCalls ? "tool-calls" : "stop";
  }
  const reason = finishReasonMap[finishReason];
  if (reason == null) {
    return hasToolCalls ? "tool-calls" : "stop";
  }
  return reason;
};

const escapeJSONDelta = (delta: string): string => JSON.stringify(delta).slice(1, -1);

const makeItemIdMetadata = (itemId: string | undefined): Record<string, string> =>
  Predicate.isNotUndefined(itemId) ? { itemId } : {};

const makeEncryptedContentMetadata = (
  encryptedContent: string | null | undefined,
): Record<string, string> => (Predicate.isNotNullish(encryptedContent) ? { encryptedContent } : {});

const getUsage = (usage: OpenAiSchema.ResponseUsage | null | undefined): Response.Usage => {
  if (Predicate.isNullish(usage)) {
    return new Response.Usage({
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
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const inputTokensDetails = (usage as any).input_tokens_details;
  const outputTokensDetails = (usage as any).output_tokens_details;
  const cachedTokens =
    Predicate.hasProperty(inputTokensDetails, "cached_tokens") &&
    typeof inputTokensDetails.cached_tokens === "number"
      ? inputTokensDetails.cached_tokens
      : 0;
  const reasoningTokens =
    Predicate.hasProperty(outputTokensDetails, "reasoning_tokens") &&
    typeof outputTokensDetails.reasoning_tokens === "number"
      ? outputTokensDetails.reasoning_tokens
      : 0;

  return new Response.Usage({
    inputTokens: {
      uncached: inputTokens - cachedTokens,
      total: inputTokens,
      cacheRead: cachedTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens - reasoningTokens,
      reasoning: reasoningTokens,
    },
  });
};

// =============================================================================
// State types
// =============================================================================

type ReasoningSummaryPartStatus = "active" | "can-conclude" | "concluded";

type ReasoningPart = {
  encryptedContent: string | undefined;
  summaryParts: Record<number, ReasoningSummaryPartStatus>;
};

// =============================================================================
// Transform
// =============================================================================

/**
 * Transforms a stream of OpenAI Response API stream events into Effect AI
 * stream parts.
 *
 * **When to use**
 *
 * Use when you have a raw stream of SSE events from the OpenAI Responses API
 * and want to convert them to Effect's standard `StreamPartEncoded` format for
 * downstream processing.
 *
 * **Details**
 *
 * The function handles text deltas, reasoning summaries, tool calls, response
 * lifecycle events, and error events. It maintains internal state to properly
 * emit text-start/text-end, reasoning-start/reasoning-end, and tool-params
 * events.
 *
 * @example
 *
 * ```ts
 * import { OpenAiClient } from "@effect/ai-openai"
 * import { transform } from "@open-insight/core/agent/builtin/openai"
 *
 * const events = OpenAiClient.createResponseStream({ ... })
 * const parts = transform(events)
 * ```
 */
export const transform = <E, R>(
  stream: Stream.Stream<ResponseStreamEvent, E, R>,
): Stream.Stream<Response.StreamPartEncoded, E, R> => {
  let activeTextId: string | undefined;
  let hasToolCalls = false;
  const activeAnnotations: Array<OpenAiSchema.Annotation> = [];

  const activeReasoning: Record<string, ReasoningPart> = {};

  const getOrCreateReasoningPart = (
    itemId: string,
    encryptedContent?: string | null,
  ): ReasoningPart => {
    const activePart = activeReasoning[itemId];
    if (Predicate.isNotUndefined(activePart)) {
      if (Predicate.isNotNullish(encryptedContent)) {
        activePart.encryptedContent = encryptedContent;
      }
      return activePart;
    }

    const reasoningPart: ReasoningPart = {
      encryptedContent: Predicate.isNotNullish(encryptedContent) ? encryptedContent : undefined,
      summaryParts: {},
    };
    activeReasoning[itemId] = reasoningPart;
    return reasoningPart;
  };

  // Track active function call names by output_index so we can correlate
  // function_call_arguments.delta/done events with the function name
  const activeFunctionCallNames: Record<number, string> = {};

  return stream.pipe(
    Stream.mapEffect(
      Effect.fnUntraced(function* (event: ResponseStreamEvent) {
        const parts: Array<Response.StreamPartEncoded> = [];

        if (!isKnownResponseStreamEvent(event)) {
          return parts;
        }

        switch (event.type) {
          // =============================================================
          // Response lifecycle events
          // =============================================================

          case "response.created": {
            const createdAt = new Date(event.response.created_at * 1000);
            parts.push({
              type: "response-metadata",
              id: event.response.id,
              modelId: event.response.model,
              timestamp: DateTime.formatIso(DateTime.fromDateUnsafe(createdAt)),
            });
            break;
          }

          case "error": {
            parts.push({
              type: "error",
              error: event,
            });
            break;
          }

          case "response.completed":
          case "response.incomplete":
          case "response.failed": {
            parts.push({
              type: "finish",
              reason: resolveFinishReason(event.response.incomplete_details?.reason, hasToolCalls),
              usage: getUsage(event.response.usage),
            });
            break;
          }

          // =============================================================
          // Output item added events (nested by item type)
          // =============================================================

          case "response.output_item.added": {
            switch (event.item.type) {
              case "message": {
                activeAnnotations.length = 0;
                activeTextId = event.item.id;
                parts.push({
                  type: "text-start",
                  id: activeTextId,
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "reasoning": {
                const reasoningPart = getOrCreateReasoningPart(
                  event.item.id,
                  event.item.encrypted_content,
                );
                if (Predicate.isUndefined(reasoningPart.summaryParts[0])) {
                  reasoningPart.summaryParts[0] = "active";
                  parts.push({
                    type: "reasoning-start",
                    id: `${event.item.id}:0`,
                    metadata: {
                      openai: {
                        ...makeItemIdMetadata(event.item.id),
                        ...makeEncryptedContentMetadata(reasoningPart.encryptedContent),
                      },
                    },
                  });
                }
                break;
              }

              case "function_call": {
                activeFunctionCallNames[event.output_index] = event.item.name;
                parts.push({
                  type: "tool-params-start",
                  id: event.item.call_id,
                  name: event.item.name,
                });
                break;
              }

              case "web_search_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: "web_search",
                  params: {},
                  providerExecuted: true,
                });
                break;
              }

              case "file_search_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: "file_search",
                  params: {},
                  providerExecuted: true,
                });
                break;
              }

              case "code_interpreter_call": {
                parts.push({
                  type: "tool-params-start",
                  id: event.item.id,
                  name: "code_interpreter",
                  providerExecuted: true,
                });
                parts.push({
                  type: "tool-params-delta",
                  id: event.item.id,
                  delta: `{"containerId":"${event.item.container_id}","code":"`,
                });
                break;
              }

              case "apply_patch_call": {
                const toolId = event.item.call_id;
                parts.push({
                  type: "tool-params-start",
                  id: toolId,
                  name: "apply_patch",
                });
                parts.push({
                  type: "tool-params-delta",
                  id: toolId,
                  delta:
                    `{"call_id":"${escapeJSONDelta(toolId)}",` +
                    `"operation":{"type":"${escapeJSONDelta(event.item.operation.type)}",` +
                    `"path":"${escapeJSONDelta(event.item.operation.path)}","diff":"`,
                });
                break;
              }

              case "computer_call": {
                parts.push({
                  type: "tool-params-start",
                  id: event.item.id,
                  name: "computer_use",
                  providerExecuted: true,
                });
                break;
              }

              case "shell_call": {
                // Emitted on output_item.done
                break;
              }

              case "image_generation_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: "image_generation",
                  params: {},
                  providerExecuted: true,
                });
                break;
              }

              case "local_shell_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.call_id,
                  name: "local_shell",
                  params: { action: event.item.action },
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "mcp_call":
              case "mcp_list_tools":
              case "mcp_approval_request": {
                // Emitted on output_item.done
                break;
              }
            }
            break;
          }

          // =============================================================
          // Output item done events (nested by item type)
          // =============================================================

          case "response.output_item.done": {
            switch (event.item.type) {
              case "apply_patch_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.call_id,
                  name: "apply_patch",
                  params: {
                    call_id: event.item.call_id,
                    operation: event.item.operation,
                  },
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "code_interpreter_call": {
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: "code_interpreter",
                  isFailure: false,
                  result: { outputs: event.item.outputs },
                  providerExecuted: true,
                });
                break;
              }

              case "computer_call": {
                const toolName = "computer_use";
                parts.push({
                  type: "tool-params-end",
                  id: event.item.id,
                });
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: toolName,
                  params: {},
                  providerExecuted: true,
                });
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: toolName,
                  isFailure: false,
                  result: { status: event.item.status ?? "completed" },
                });
                break;
              }

              case "file_search_call": {
                const results = Predicate.isNotNullish(event.item.results)
                  ? { results: event.item.results }
                  : undefined;
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: "file_search",
                  isFailure: false,
                  result: {
                    ...results,
                    status: event.item.status,
                    queries: event.item.queries,
                  },
                  providerExecuted: true,
                });
                break;
              }

              case "function_call": {
                hasToolCalls = true;
                const fcItem = event.item as OpenAiSchema.InputItem & {
                  readonly type: "function_call";
                  readonly call_id: string;
                  readonly name: string;
                  readonly arguments: string;
                  readonly id?: string | undefined;
                };
                const toolName = fcItem.name;
                const toolParams = yield* Effect.sync(() => {
                  try {
                    return Tool.unsafeSecureJsonParse(fcItem.arguments);
                  } catch {
                    return fcItem.arguments;
                  }
                });
                delete activeFunctionCallNames[event.output_index];

                parts.push({
                  type: "tool-params-end",
                  id: event.item.call_id,
                });
                parts.push({
                  type: "tool-call",
                  id: event.item.call_id,
                  name: toolName,
                  params: toolParams,
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "image_generation_call": {
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: "image_generation",
                  isFailure: false,
                  result: { result: event.item.result },
                  providerExecuted: true,
                });
                break;
              }

              case "local_shell_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.call_id,
                  name: "local_shell",
                  params: { action: event.item.action },
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "mcp_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: "mcp",
                  params: event.item.arguments,
                  providerExecuted: true,
                });
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: "mcp",
                  isFailure: false,
                  providerExecuted: true,
                  result: {
                    type: "mcp_call",
                    name: event.item.name,
                    arguments: event.item.arguments,
                    server_label: event.item.server_label,
                    ...(Predicate.isNotNullish(event.item.output)
                      ? { output: event.item.output }
                      : undefined),
                    ...(Predicate.isNotNullish(event.item.error)
                      ? { error: event.item.error }
                      : undefined),
                  },
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "mcp_list_tools": {
                break;
              }

              case "mcp_approval_request": {
                const approvalRequestId = (event.item as any).approval_request_id ?? event.item.id;
                parts.push({
                  type: "tool-call",
                  id: event.item.id,
                  name: "mcp",
                  params: event.item.arguments,
                  providerExecuted: true,
                });
                parts.push({
                  type: "tool-approval-request",
                  approvalId: approvalRequestId,
                  toolCallId: event.item.id,
                });
                break;
              }

              case "message": {
                const annotations =
                  activeAnnotations.length > 0
                    ? { annotations: activeAnnotations.slice() }
                    : undefined;
                parts.push({
                  type: "text-end",
                  id: event.item.id,
                  metadata: {
                    openai: {
                      ...annotations,
                      ...makeItemIdMetadata(event.item.id),
                    },
                  },
                });
                activeTextId = undefined;
                break;
              }

              case "reasoning": {
                const reasoningPart = getOrCreateReasoningPart(
                  event.item.id,
                  event.item.encrypted_content,
                );
                for (const [summaryIndex, status] of Object.entries(reasoningPart.summaryParts)) {
                  if (status === "active" || status === "can-conclude") {
                    parts.push({
                      type: "reasoning-end",
                      id: `${event.item.id}:${summaryIndex}`,
                      metadata: {
                        openai: {
                          ...makeItemIdMetadata(event.item.id),
                          ...makeEncryptedContentMetadata(reasoningPart.encryptedContent),
                        },
                      },
                    });
                  }
                }
                delete activeReasoning[event.item.id];
                break;
              }

              case "shell_call": {
                parts.push({
                  type: "tool-call",
                  id: event.item.id ?? event.item.call_id,
                  name: "shell",
                  params: { action: event.item.action },
                  metadata: { openai: makeItemIdMetadata(event.item.id) },
                });
                break;
              }

              case "web_search_call": {
                parts.push({
                  type: "tool-result",
                  id: event.item.id,
                  name: "web_search",
                  isFailure: false,
                  result: {
                    action: event.item.action,
                    status: event.item.status,
                  },
                  providerExecuted: true,
                });
                break;
              }
            }
            break;
          }

          // =============================================================
          // Text delta events
          // =============================================================

          case "response.output_text.delta": {
            parts.push({
              type: "text-delta",
              id: event.item_id,
              delta: event.delta,
            });
            break;
          }

          case "response.output_text.annotation.added": {
            const annotation = event.annotation as OpenAiSchema.Annotation;
            activeAnnotations.push(annotation);
            if (annotation.type === "container_file_citation") {
              parts.push({
                type: "source",
                sourceType: "document",
                id: `${event.item_id}:annotation:${event.annotation_index}`,
                mediaType: "text/plain",
                title: annotation.filename,
                fileName: annotation.filename,
                metadata: {
                  openai: {
                    type: annotation.type,
                    fileId: annotation.file_id,
                    containerId: annotation.container_id,
                  },
                },
              });
            } else if (annotation.type === "file_citation") {
              parts.push({
                type: "source",
                sourceType: "document",
                id: `${event.item_id}:annotation:${event.annotation_index}`,
                mediaType: "text/plain",
                title: annotation.filename,
                fileName: annotation.filename,
                metadata: {
                  openai: {
                    type: annotation.type,
                    fileId: annotation.file_id,
                    index: annotation.index,
                  },
                },
              });
            } else if (annotation.type === "file_path") {
              parts.push({
                type: "source",
                sourceType: "document",
                id: `${event.item_id}:annotation:${event.annotation_index}`,
                mediaType: "application/octet-stream",
                title: annotation.file_id,
                fileName: annotation.file_id,
                metadata: {
                  openai: {
                    type: annotation.type,
                    fileId: annotation.file_id,
                    index: annotation.index,
                  },
                },
              });
            } else if (annotation.type === "url_citation") {
              parts.push({
                type: "source",
                sourceType: "url",
                id: `${event.item_id}:annotation:${event.annotation_index}`,
                url: annotation.url,
                title: annotation.title,
                metadata: {
                  openai: {
                    type: annotation.type,
                    startIndex: annotation.start_index,
                    endIndex: annotation.end_index,
                  },
                },
              });
            }
            break;
          }

          // =============================================================
          // Reasoning events
          // =============================================================

          case "response.reasoning_summary_part.added": {
            const reasoningPart = getOrCreateReasoningPart(event.item_id);
            if (event.summary_index > 0) {
              for (const [summaryIndex, status] of Object.entries(reasoningPart.summaryParts)) {
                if (status === "can-conclude") {
                  parts.push({
                    type: "reasoning-end",
                    id: `${event.item_id}:${summaryIndex}`,
                    metadata: {
                      openai: {
                        ...makeItemIdMetadata(event.item_id),
                        ...makeEncryptedContentMetadata(reasoningPart.encryptedContent),
                      },
                    },
                  });
                  reasoningPart.summaryParts[Number(summaryIndex)] = "concluded";
                }
              }
            }

            if (Predicate.isUndefined(reasoningPart.summaryParts[event.summary_index])) {
              reasoningPart.summaryParts[event.summary_index] = "active";
              parts.push({
                type: "reasoning-start",
                id: `${event.item_id}:${event.summary_index}`,
                metadata: {
                  openai: {
                    ...makeItemIdMetadata(event.item_id),
                    ...makeEncryptedContentMetadata(reasoningPart.encryptedContent),
                  },
                },
              });
            }
            break;
          }

          case "response.reasoning_summary_text.delta": {
            parts.push({
              type: "reasoning-delta",
              id: `${event.item_id}:${event.summary_index}`,
              delta: event.delta,
              metadata: { openai: makeItemIdMetadata(event.item_id) },
            });
            break;
          }

          case "response.reasoning_summary_part.done": {
            const reasoningPart = getOrCreateReasoningPart(event.item_id);
            parts.push({
              type: "reasoning-end",
              id: `${event.item_id}:${event.summary_index}`,
              metadata: {
                openai: {
                  ...makeItemIdMetadata(event.item_id),
                  ...makeEncryptedContentMetadata(reasoningPart.encryptedContent),
                },
              },
            });
            reasoningPart.summaryParts[event.summary_index] = "concluded";
            break;
          }

          // =============================================================
          // Function call delta/done events
          // =============================================================

          case "response.function_call_arguments.delta": {
            parts.push({
              type: "tool-params-delta",
              id: event.item_id,
              delta: event.delta,
            });
            break;
          }

          case "response.function_call_arguments.done": {
            hasToolCalls = true;
            const toolName = activeFunctionCallNames[event.output_index] ?? "function";
            const toolParams = yield* Effect.sync(() => {
              try {
                return Tool.unsafeSecureJsonParse(event.arguments);
              } catch {
                return event.arguments;
              }
            });
            delete activeFunctionCallNames[event.output_index];

            parts.push({
              type: "tool-params-end",
              id: event.item_id,
            });
            parts.push({
              type: "tool-call",
              id: event.item_id,
              name: toolName,
              params: toolParams,
            });
            break;
          }

          // =============================================================
          // Code interpreter events
          // =============================================================

          case "response.code_interpreter_call_code.delta": {
            parts.push({
              type: "tool-params-delta",
              id: event.item_id,
              delta: escapeJSONDelta(event.delta),
            });
            break;
          }

          case "response.code_interpreter_call_code.done": {
            parts.push({
              type: "tool-params-delta",
              id: event.item_id,
              delta: '"}',
            });
            parts.push({
              type: "tool-params-end",
              id: event.item_id,
            });
            parts.push({
              type: "tool-call",
              id: event.item_id,
              name: "code_interpreter",
              params: { code: event.code },
              providerExecuted: true,
            });
            break;
          }

          // =============================================================
          // Apply patch diff events
          // =============================================================

          case "response.apply_patch_call_operation_diff.delta": {
            parts.push({
              type: "tool-params-delta",
              id: event.item_id,
              delta: escapeJSONDelta(event.delta),
            });
            break;
          }

          case "response.apply_patch_call_operation_diff.done": {
            if (Predicate.isNotUndefined(event.delta)) {
              parts.push({
                type: "tool-params-delta",
                id: event.item_id,
                delta: escapeJSONDelta(event.delta),
              });
            }
            parts.push({
              type: "tool-params-delta",
              id: event.item_id,
              delta: `"}}`,
            });
            parts.push({
              type: "tool-params-end",
              id: event.item_id,
            });
            break;
          }

          // =============================================================
          // Image generation partial events
          // =============================================================

          case "response.image_generation_call.partial_image": {
            parts.push({
              type: "tool-result",
              id: event.item_id,
              name: "image_generation",
              isFailure: false,
              providerExecuted: true,
              result: { result: event.partial_image_b64 },
              preliminary: true,
            });
            break;
          }
        }

        return parts;
      }),
    ),
    Stream.flattenIterable,
  );
};
