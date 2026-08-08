# ACP SessionUpdate to Effect AI Parts

This module converts ACP `SessionUpdate` values into `effect/unstable/ai`
`Response.PartEncoded` values (the non-streaming serialized response parts).

## Model Comparison

ACP session updates are a session-scoped event stream. They include assistant
message chunks, thought chunks, tool progress snapshots, plans, session UI
state, configuration changes, mode changes, command lists, and context/cost
usage.

Effect AI parts model one AI response. Because this transform emits
`Response.PartEncoded` (non-streaming), each text or reasoning segment
accumulates its chunks into a single complete `text` or `reasoning` part; tool
calls, tool results, file parts, response metadata, and finish parts carry the
same shapes as their non-streaming counterparts. ACP tools are not known at
compile time, so the transform exposes them through the dynamic-tool-compatible
`Response.PartEncoded` type.

The transform assumes every update belongs to the same ACP session. It does not
validate session identity.

## Mapping Decisions

| ACP update                                                                                        | Effect AI output              | Reason                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `agent_message_chunk` text                                                                        | `text`                        | Chunks accumulate into one complete non-streaming text part.                                           |
| `agent_thought_chunk` text                                                                        | `reasoning`                   | Effect AI has a dedicated reasoning part.                                                              |
| `user_message_chunk`                                                                              | `response-metadata`           | User chunks are transcript input, not assistant response text.                                         |
| Non-text content blocks                                                                           | `file` or `response-metadata` | Preserve structured payloads without inventing display text.                                           |
| `tool_call`                                                                                       | `tool-call`                   | Preserves the model/tool action boundary.                                                              |
| `tool_call_update`                                                                                | `tool-result`                 | `pending` and `in_progress` become preliminary results; `completed` and `failed` become final results. |
| `plan`, `plan_update`, `plan_removed`                                                             | `response-metadata`           | Plans are ACP UI/progress state, not model text.                                                       |
| `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update` | `response-metadata`           | These are session/client state events.                                                                 |
| `usage_update`                                                                                    | `finish`                      | Effect AI carries usage on finish parts.                                                               |

ACP-specific details are stored under `metadata.acp`. Metadata values are kept
JSON compatible. Unknown values such as `rawInput` and `rawOutput` are copied
only when JSON-safe; otherwise they are replaced with an omission marker.

## Segment Accumulation

ACP text and thought chunks can share a `messageId`. The first chunk for an id
opens a segment and starts an accumulation buffer; each subsequent chunk with
the same id appends to that buffer. Switching to a new id closes the previous
segment and emits a complete `text` or `reasoning` part carrying the buffered
text. If ACP omits `messageId`, the transform creates deterministic ids such as
`acp-agent-message-1` and `acp-agent-thought-1`.

At upstream completion, the transform closes any open text or reasoning
segments and emits a default `finish` part when no `usage_update` produced one.
Input stream errors remain in the stream error channel and are not converted
into `Response.ErrorPart`.

## Limitations

ACP resource and media content does not always map exactly to Effect AI parts.
Images, audio, and blob resources are mapped to file parts when their base64
payload decodes successfully. Resource links and text resources are preserved
as metadata only.

ACP tool schemas are not available in `SessionUpdate`, so tool params and
results are typed as `unknown` through dynamic tool parts. The original
ACP update is preserved in `metadata.acp`.

## Effect AI UserMessage to ACP Prompt

The reverse, non-streaming boundary converts one Effect AI `Prompt.UserMessage`
into the `prompt` field of an ACP `PromptRequest`. It deliberately accepts a
user message rather than a `Prompt.Prompt`: an Effect prompt can contain system,
assistant, tool, and historical messages, while ACP `session/prompt` represents
exactly one new user turn and has no role or message-boundary fields.

### API and ownership

```ts
import type { PromptCapabilities, PromptRequest } from "@agentclientprotocol/sdk";
import type { Effect } from "effect";
import type { Prompt } from "effect/unstable/ai";

export interface ToAcpPromptOptions {
  readonly promptCapabilities?: PromptCapabilities;
}

export declare const toAcpPrompt: (
  message: Prompt.UserMessage,
  options?: ToAcpPromptOptions,
) => Effect.Effect<PromptRequest["prompt"], Error>;
```

The function returns only `PromptRequest["prompt"]`. The ACP session adapter
owns `sessionId`, request metadata, connection state, cancellation, and the
actual `session/prompt` call. `Prompt.UserMessage.options` and per-part provider
options are not ACP semantics and are intentionally not forwarded.

`promptCapabilities` is the capability snapshot negotiated during ACP
initialization. Omitting it is equivalent to the ACP baseline: text and
resource links are allowed, while image, audio, and embedded resource blocks
are rejected. Capability checks belong in this conversion because otherwise a
well-typed result could still violate the target agent's negotiated protocol.

### Content mapping

Each Effect user part produces exactly one ACP block, in the same order:

| Effect user part                             | ACP content block      | Rule                                                                 |
| -------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `text`                                       | `text`                 | Preserve the string exactly, including empty strings and whitespace. |
| `file` whose data is a `URL`                 | `resource_link`        | Preserve the URL and MIME type; derive the required name safely.     |
| in-memory `file` with an `image/*` MIME type | `image`                | Encode bytes as base64; requires `image: true`.                      |
| in-memory `file` with an `audio/*` MIME type | `audio`                | Encode bytes as base64; requires `audio: true`.                      |
| any other in-memory `file`                   | embedded blob resource | Preserve MIME and base64 bytes; requires `embeddedContext: true`.    |

For a resource link, `fileName` is preferred as its ACP `name`; otherwise the
last non-empty path segment of a hierarchical URL is decoded, then the URL host
is used, then the scheme without its colon, and finally `resource`. Invalid
percent escapes must not make conversion fail; the undecoded path segment is a
valid fallback. The full URI is never copied into `name`, which avoids
duplicating a large `data:` URI while preserving it in the actual `uri` field.

ACP embedded resources require a URI even when the Effect file is only bytes.
The converter assigns a deterministic, local identifier
`urn:open-insight:prompt-file:<part-index>` and preserves `fileName`, when
present, in an `open-insight/fileName` extension in `_meta`. The identifier is
not claimed to be dereferenceable; the blob is the authoritative content.

### File data rules

Effect file data has three representations:

1. `Uint8Array` is encoded with `Encoding.encodeBase64`.
2. A string is accepted as either strict base64 or a base64 data URL. Data URLs
   are unwrapped before constructing ACP content.
3. `URL` stays a resource link. The converter never fetches it and never
   guesses that a URL's bytes are locally available.

A data URL must use the `;base64` form and must have a media type equal to the
Effect part's explicit `mediaType`, compared case-insensitively. Parameters
other than `base64` are rejected rather than silently discarded. Raw base64 and
the extracted data URL payload must be accepted by `Encoding.decodeBase64`,
then are re-encoded to canonical padded base64. Empty binary data remains valid.

Strings that look like provider file IDs, ordinary URLs, malformed data URLs,
or invalid base64 fail conversion. Only an actual `URL` value means a linked
resource; this avoids guessing between the two meanings of Effect's string
representation.

### Errors and atomicity

The top-level `Acp.Error` wraps a schema-based `PromptError`. `PromptError`
contains a machine-readable reason, the zero-based `partIndex`, the Effect
`partType`, and optional `mediaType` and `capability`. Reasons cover:

- `capability_not_enabled`
- `invalid_base64`
- `invalid_data_url`
- `data_url_media_type_mismatch`

Conversion is atomic. It returns the complete ordered block array or fails; it
never drops an unsupported part and never returns a partial prompt. Error
messages must not include the base64 payload.

### Edge cases and limits

- An empty `UserMessage.content` maps to an empty ACP prompt array because both
  installed schemas allow it. The session adapter may impose a product-level
  non-empty policy separately.
- Multiple adjacent text parts remain multiple ACP text blocks. Merging them
  would erase a boundary represented by both models.
- MIME matching for image and audio is case-insensitive. Other MIME types use
  an embedded blob; no type is guessed from a filename or URL.
- URL schemes are preserved. Capability negotiation, not the converter,
  determines whether the agent can read a particular URI in practice.
- ACP has no standard filename field on image/audio/blob content. Image and
  audio filenames are therefore not forwarded; blob filenames use the namespaced
  `_meta` extension described above.
- The conversion targets the repository's stable ACP entrypoint, matching the
  existing stream converter. It does not mix stable and experimental v2 types.

### Implementation and verification plan

1. Define the ACP module `Error` and `PromptError` in `error.ts`, then define
   `ToAcpPromptOptions` and the exported `Effect.fn`-based `toAcpPrompt` in
   `prompt.ts`.
2. Keep helpers pure for URL naming, data URL parsing, base64 normalization,
   capability checks, and content-block construction.
3. Add focused tests for ordering, empty text/content, URL naming fallbacks,
   bytes, raw base64, data URLs, generic blobs, each capability gate, malformed
   inputs, MIME mismatch, atomic failure, and input immutability.
4. Export the prompt converter from the ACP prompt module boundary used by the
   future session adapter, then run the package tests and `vp check` from
   `packages/core`.
