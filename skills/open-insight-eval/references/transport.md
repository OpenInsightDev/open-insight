# Transports

A transport delivers the evaluation event stream to a destination. `Eval.run` publishes events (task/trail scheduling, streamed agent parts, metric updates) to a queue; a transport consumed the stream via `send`. When no transport is provided to the `Event.Transport.Service`, events are drained and discarded, so provide a transport whenever you need to observe or persist a run.

## Service

Provide a transport with `Effect.provideService(Event.Transport.Service, transport)`. `Eval.run` picks it up automatically; the run finishes only after the transport has consumed the stream.

## Built-in transports

- `Transport.Sse.make({ baseUrl, endpoint })` — POSTs the event stream to an HTTP endpoint as server-sent events. Requires an `HttpClient`.
- `Transport.Console.make({ format })` — prints each event to the console as it is published. `format` overrides the default pretty-printed JSON rendering (with a `String(value)` fallback for payloads that do not serialize).

## Custom transports

A transport is a plain value: `{ send(stream) }` where `stream` is a `Stream` of `Event`. Use `Stream.tap` to inspect events without altering the stream, or `Stream.runDrain` to terminate the pipeline. Return an `Effect` from `send`; surface delivery failures as `EventError` via `EventError.send` / `EventError.invalid`.
