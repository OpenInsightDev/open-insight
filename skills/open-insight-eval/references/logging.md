# Logging

`Eval.run` controls Effect log output through two `Config` options:

- `console: boolean` — whether to emit Effect log output to the console. Defaults to `true`.
- `logLevel: LogLevel` — the minimum severity shown. Defaults to `"Info"`. Ignored when `console` is `false`.

`console` controls log output only; it has nothing to do with the event stream. Event
stream output is handled separately by the `Event.Transport.Service` (see
`transport.md`).

## How it maps to Effect

`Eval.run` applies the options by providing `References.MinimumLogLevel` for the whole run:

- When `console` is `true`, it sets the minimum log level to `logLevel`, but never loosens
  a more restrictive minimum already provided by the surrounding fiber.
- When `console` is `false`, it sets the minimum log level to `"None"`, silencing all log
  output.

## Example

```ts
Eval.run({ console: true, logLevel: "Debug" })(bench)
```

Shows `Debug`-and-above logs. `Eval.run({ console: false })(bench)` silences log output
while still emitting events to any provided transport.
