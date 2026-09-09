# Sandbox

Sandbox services use `SandboxError` as their typed error channel.

## Services

- `Sandbox.FileSystem` wraps platform filesystem failures as `FileSystemOperationFailed` reasons.
- `Sandbox.Process` wraps child-process platform failures as `ProcessOperationFailed` reasons.
- `Sandbox.Terminal` exposes terminal I/O with `SandboxError`; it reuses Effect's `UserInput` and `QuitError` models.

The adapter inputs of `Sandbox.FileSystem.make` and `Sandbox.Process.make` still use Effect's `PlatformError`. That error is converted at the service boundary and is not exposed by the sandbox services.

## Error reasons

`SandboxError` wraps `ErrorReason`, which includes the existing snapshot, provider, lifecycle, execution, port-exposure, snapshot-support, and assertion reasons, plus:

- `FileSystemOperationFailed` — `operation`, `path`, and the underlying `cause`.
- `ProcessOperationFailed` — `operation`, formatted `command`, and the underlying `cause`.
- `TerminalOperationFailed` — terminal `operation` and the underlying `cause`.
- Effect `PlatformError` — retained as a reason for callers that provide an already-normalized platform error.

Causes are preserved as defects and rendered with `Formatter.format`. Use `SandboxError.fileSystem`, `SandboxError.process`, and `SandboxError.terminal` to construct the semantic variants.

For reason-aware recovery, match the outer `SandboxError` and then its `reason` tag, for example with `Effect.catchReason` or by inspecting `error.reason._tag`.
