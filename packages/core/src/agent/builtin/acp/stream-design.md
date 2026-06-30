# ACP SessionUpdate to Effect AI Stream

This module converts ACP `SessionUpdate` values into `effect/unstable/ai`
`Response.StreamPart` values.

## Model Comparison

ACP session updates are a session-scoped event stream. They include assistant
message chunks, thought chunks, tool progress snapshots, plans, session UI
state, configuration changes, mode changes, command lists, and context/cost
usage.

Effect AI stream parts model one AI response. They have explicit
`text-start`/`text-delta`/`text-end`, `reasoning-start`/`reasoning-delta`/
`reasoning-end`, metadata, finish, error, tool-call, and tool-result parts.
ACP tools are not known at compile time, so the transform exposes them through
the dynamic-tool-compatible `Response.StreamPart<Record<string, Tool.AnyDynamic>>`
type.

The transform assumes every update belongs to the same ACP session. It does not
validate session identity.

## Mapping Decisions

| ACP update                                                                                        | Effect AI output                                      | Reason                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `agent_message_chunk` text                                                                        | `text-start`, `text-delta`, `text-end`                | Preserves streaming message boundaries.                                                                |
| `agent_thought_chunk` text                                                                        | `reasoning-start`, `reasoning-delta`, `reasoning-end` | Effect AI has a dedicated reasoning stream.                                                            |
| `user_message_chunk`                                                                              | `response-metadata`                                   | User chunks are transcript input, not assistant response text.                                         |
| Non-text content blocks                                                                           | `file` or `response-metadata`                         | Preserve structured payloads without inventing display text.                                           |
| `tool_call`                                                                                       | `tool-call`                                           | Preserves the model/tool action boundary.                                                              |
| `tool_call_update`                                                                                | `tool-result`                                         | `pending` and `in_progress` become preliminary results; `completed` and `failed` become final results. |
| `plan`, `plan_update`, `plan_removed`                                                             | `response-metadata`                                   | Plans are ACP UI/progress state, not model text.                                                       |
| `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update` | `response-metadata`                                   | These are session/client state events.                                                                 |
| `usage_update`                                                                                    | `finish`                                              | Effect AI carries usage on finish parts.                                                               |

ACP-specific details are stored under `metadata.acp`. Metadata values are kept
JSON compatible. Unknown values such as `rawInput` and `rawOutput` are copied
only when JSON-safe; otherwise they are replaced with an omission marker.

## Stream Boundaries

ACP text and thought chunks can share a `messageId`. The first chunk for an id
opens an Effect AI stream part, each chunk emits a delta, and switching to a
new id closes the previous active stream. If ACP omits `messageId`, the
transform creates deterministic ids such as `acp-agent-message-1` and
`acp-agent-thought-1`.

At upstream completion, the transform closes any open text or reasoning
streams and emits a default `finish` part when no `usage_update` produced one.
Input stream errors remain in the stream error channel and are not converted
into `Response.ErrorPart`.

## Limitations

ACP resource and media content does not always map exactly to Effect AI parts.
Images, audio, and blob resources are mapped to file parts when their base64
payload decodes successfully. Resource links and text resources are preserved
as metadata only.

ACP tool schemas are not available in `SessionUpdate`, so tool params and
results are typed as `unknown` through dynamic tool stream parts. The original
ACP update is preserved in `metadata.acp`.
