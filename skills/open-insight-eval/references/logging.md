# Logging

`Eval.run` controls Effect log output through two independent `Config` options.

- `console: boolean` — whether to attach a console logger. Defaults to `true`.
- `logLevel: LogLevel` — the minimum severity shown. Defaults to `"Info"`.

`logLevel` falls back to the `OPENINSIGHT_LOG_LEVEL` environment variable.
Accepted values are the Effect `LogLevel` literals: `"All"`, `"Fatal"`, `"Error"`, `"Warn"`, `"Info"`, `"Debug"`, `"Trace"`, or `"None"`.
An explicit programmatic `logLevel` overrides the environment variable.
A malformed `OPENINSIGHT_LOG_LEVEL` value fails evaluation initialization.

`logLevel` sets `References.MinimumLogLevel` for the whole run, filtering every log entry below that severity before it reaches any logger.
`console` controls only whether the default console logger is attached, adding a terminal copy of the log on top of whatever other loggers already exist.

Neither option has anything to do with the event stream.
Event stream output is handled separately by the `Event.Transport.Service` (see `transport.md`).

## How it maps to Effect

`Eval.run` applies the options in two parts, following Effect's logging model.

First it provides `References.MinimumLogLevel` via `Effect.provideService(effect, References.MinimumLogLevel, config.logLevel)`.
Because a filter alone prints nothing, when `console` is `true` it also adds the default console logger with `Effect.withLogger(effect, Logger.defaultLogger)`.
`withLogger` merges this logger into the existing logger set, so a copy of the log reaches the console even if the surrounding environment replaced the loggers (for example, with an OpenTelemetry logger).
When `console` is `false`, no console logger is added.

## Example

```ts
Eval.run({ console: true, logLevel: "Debug" })(bench)
```

Shows `Debug`-and-above logs.
`Eval.run({ console: false, logLevel: "Debug" })(bench)` keeps logs flowing to other loggers but adds no terminal copy, while still emitting events to any provided transport.
