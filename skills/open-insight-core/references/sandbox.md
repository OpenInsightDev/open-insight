# Sandbox

Sandbox services use `SandboxError` as their typed error channel.

## Services

- `Sandbox.FileSystem` exposes the sandbox filesystem and reports every failure as a `FileSystemOperationFailed` reason.
- `Sandbox.Process` wraps child-process platform failures as `ProcessOperationFailed` reasons.
- `Sandbox.Terminal` exposes terminal I/O with `SandboxError`; it reuses Effect's `UserInput` and `QuitError` models.

The adapter input of `Sandbox.Process.make` still uses Effect's `PlatformError`. That error is converted at the service boundary and is not exposed by the sandbox services.

## FileSystem over WebDAV

`Sandbox.FileSystem.layerWebDAV({ client })` implements the service with a `webdav-client` client.
The client's `Auth` and `Transport` services are captured when the layer is built, so provide them alongside it, for example with `WebDAV.ClientLayer(config)`.

The service only declares operations WebDAV can carry out, so it is narrower than Effect's `FileSystem`:

- `remove(path)` behaves like `rm -rf`; `DELETE` always removes a directory with its members and a missing path succeeds.
- `sink(path)` buffers the incoming chunks and writes them with one `PUT`; there are no `OpenFlag` or POSIX mode options.
- `stream(path, { offset, bytesToRead })` maps to an HTTP `Range` request; chunk sizes are decided by the transport.
- `readDirectory` returns entry names relative to `path`, and `glob` lists the tree below `root` and matches locally.
- `writeFileString` always encodes UTF-8, while `readFileString(path, encoding)` decodes with any `TextDecoder` encoding.
- There are no temporary file or directory operations, no `truncate`, and no POSIX permission, ownership, or link operations, because WebDAV cannot express them.

## Error reasons

`SandboxError` wraps `ErrorReason`, which includes the existing snapshot, provider, lifecycle, execution, port-exposure, snapshot-support, and assertion reasons, plus:

- `FileSystemOperationFailed` — `operation`, `path`, and the underlying `cause`.
- `ProcessOperationFailed` — `operation`, formatted `command`, and the underlying `cause`.
- `TerminalOperationFailed` — terminal `operation` and the underlying `cause`.
- Effect `PlatformError` — retained as a reason for callers that provide an already-normalized platform error.

Causes are preserved as defects and rendered with `Formatter.format`. Use `SandboxError.fileSystem`, `SandboxError.process`, and `SandboxError.terminal` to construct the semantic variants.

For reason-aware recovery, match the outer `SandboxError` and then its `reason` tag, for example with `Effect.catchReason` or by inspecting `error.reason._tag`.
