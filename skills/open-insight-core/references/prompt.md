# Prompt

`Prompt` is the message-building layer of the agent loop. It produces the user messages the agent session sends to the model, converts encoded model responses back into typed prompt parts, and renders Eta templates into user messages.

The module re-exports the `Prompt` type and part constructors from `effect/unstable/ai/Prompt` and adds helpers on top.

## Trajectory

`Prompt.Trajectory` is the accumulated message history of a session. `Prompt.concat(current, prompt)` appends a prompt to a trajectory, `Prompt.empty` starts a new one, and `Prompt.fromResponseParts(parts)` converts a list of response parts into trajectory content.

## Streams

- `Prompt.decodeResponseStream(stream)` decodes a stream of `Response.StreamPartEncoded` into typed `AnyStreamPart` parts; each part is decoded individually with `Schema.decodeUnknownEffect`, so a malformed part surfaces as a `Schema.SchemaError` in the stream error channel.
- `Prompt.encodeResponseStreamPartEncoded(part)` is the inverse, encoding a typed part back into its wire form.
- `Prompt.fromResponsePartEncodedStream(stream)` folds encoded stream parts into `Prompt.Part`s, accumulating `text` and `reasoning` deltas between their `-start` and `-end` markers.

## Building a Prompt Stream

`Prompt.makeStream(options, input)` returns a `Stream.Stream<Prompt.Prompt, PromptError>` — a fresh, pull-based prompt stream for one stage execution. `input` carries the runtime session state (`Prompt.Input`: the session `trajectory` `Ref` plus the sandbox). Every element the stream generates `Ref.get`s the latest trajectory and hands it to the prompt function as part of its `Prompt.Context`, so prompts always reflect the most recent agent response. Each call produces a fresh stream, so no state leaks between stage runs.

The `options` argument selects the behavior:

- pass a `Prompt.RawInput` to send it once and then complete,
- pass an `async (context) => Promise<RawInput | null>` to derive each next prompt from the trajectory and sandbox state; returning `null` completes the stream,
- or pass `{ init?, followUp }` to optionally send an `init` message first, then feed each `Context` into the `followUp` async-iterator factory.

The `followUp` factory receives the context of its first pull (async iterators ignore the argument to the first `next` call). Each later pull passes its freshly `Ref.get`-ed context through `iterator.next(context)`; the factory must read it from the value of its `yield` expression, e.g. `const latest = yield message` in an `async function*`.

## Templates

`Prompt.fromEta(filePath, data?)` loads an Eta template from disk and renders it into a text user message. `data` defaults to an empty object.

## Errors

All prompt failures are reported as `PromptError`, a single tagged wrapper over `ErrorReason`:

- `Prompt.GenerationFailed` — the prompt factory or `followUp` iterator rejected while producing the next prompt.
- `Prompt.TemplateFailed` — an Eta template could not be read from disk or rendered with the given data (carries the `filePath`).

Each factory wraps a lower-boundary error; discriminate with `Effect.catchTag` on the variant `_tag` (e.g. `"GenerationFailed"`), or match the union with `Prompt.ErrorReason`.
