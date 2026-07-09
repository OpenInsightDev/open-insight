# AI SDK TextStreamPart to Effect AI Stream

This module converts AI SDK `TextStreamPart` values, such as the values emitted
by `streamText().stream`, into `effect/unstable/ai` `Response.StreamPart`
values.

## Model Comparison

AI SDK text streams model a full generation loop. A stream can include text,
reasoning, tool input deltas, tool calls and results, approval events, sources,
files, lifecycle step events, aborts, raw provider chunks, and streamed error
parts.

Effect AI stream parts model one provider-neutral AI response. They have
explicit text, reasoning, tool parameter, tool call, tool result, approval
request, file, source, metadata, finish, and error parts.

The transform targets AI SDK v7 `TextStreamPart`, not the lower-level provider
`LanguageModelV4StreamPart`. The source stream can be supplied either as an AI
SDK `AsyncIterable` through `fromAiStream` or as an Effect `Stream` through
`transform`.

## Mapping Decisions

| AI SDK part              | Effect AI output                                    | Reason                                                                                 |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `text-start`             | `text-start`                                        | Preserves text block boundaries.                                                       |
| `text-delta`             | `text-delta`                                        | Maps AI SDK `text` to Effect `delta`.                                                  |
| `text-end`               | `text-end`                                          | Preserves text block boundaries.                                                       |
| `reasoning-start`        | `reasoning-start`                                   | Preserves reasoning block boundaries.                                                  |
| `reasoning-delta`        | `reasoning-delta`                                   | Maps AI SDK `text` to Effect `delta`.                                                  |
| `reasoning-end`          | `reasoning-end`                                     | Preserves reasoning block boundaries.                                                  |
| `tool-input-start`       | `tool-params-start`                                 | Effect represents streamed tool input as params.                                       |
| `tool-input-delta`       | `tool-params-delta`                                 | Preserves incremental tool parameter JSON.                                             |
| `tool-input-end`         | `tool-params-end`                                   | Closes streamed tool parameters.                                                       |
| `tool-call`              | `tool-call`                                         | Preserves the model/tool action boundary.                                              |
| `tool-result`            | `tool-result`                                       | Preserves framework or provider tool output.                                           |
| `tool-error`             | failed `tool-result`                                | Effect tool results can represent success and failure.                                 |
| `tool-output-denied`     | failed `tool-result`                                | Treats denied execution as a tool failure result.                                      |
| `tool-approval-request`  | `tool-approval-request`                             | Effect has a matching request part.                                                    |
| `tool-approval-response` | `response-metadata`                                 | Effect has no approval response stream part.                                           |
| `file`                   | `file`, or `response-metadata` on extraction error  | Uses AI SDK `GeneratedFile.uint8Array` and `mediaType`.                                |
| `reasoning-file`         | `file`, or `response-metadata` on extraction error  | Effect has no distinct reasoning file part, so metadata marks it as reasoning content. |
| `source` URL             | URL `source`, or `response-metadata` on invalid URL | Effect stores URLs as `URL` objects.                                                   |
| `source` document        | document `source`                                   | Maps AI SDK `filename` to Effect `fileName`.                                           |
| `start`, `start-step`    | `response-metadata`                                 | Lifecycle state, not response content.                                                 |
| `finish-step`            | `response-metadata`                                 | Per-step details are preserved without emitting an extra finish.                       |
| `custom`, `raw`          | `response-metadata`                                 | No equivalent Effect stream part.                                                      |
| `finish`                 | `finish`                                            | Carries finish reason and total usage.                                                 |
| `abort`                  | `finish` with `unknown` reason                      | Represents stream termination without inventing an error.                              |
| `error`                  | `error`                                             | AI SDK error parts are data events, not upstream stream failures.                      |

AI SDK provider metadata is stored under `metadata.aiSdk.providerMetadata`.
Additional details that do not fit the Effect part are stored under
`metadata.aiSdk.part`. Metadata is kept JSON-compatible. Non-JSON values are
replaced with an omission marker instead of being copied verbatim.

## Stream Boundaries

AI SDK already emits explicit start and end parts for text, reasoning, and tool
parameter streams, so this transform does not synthesize fallback starts, ends,
or finish parts.

Upstream stream failures remain in the Effect stream error channel. Only AI SDK
`error` parts are converted into `Response.ErrorPart` values.

## Limitations

Some AI SDK events do not have one-to-one Effect AI stream equivalents.
Lifecycle events, approval responses, raw provider chunks, and custom parts are
preserved as metadata.

Tool schemas are not available from a `TextStreamPart`, so transformed tool
parts use dynamic-tool-compatible Effect stream types. Tool inputs, outputs,
errors, and denial details are preserved as unknown values on tool call/result
parts where the Effect model supports them.
