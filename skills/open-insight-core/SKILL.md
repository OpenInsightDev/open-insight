---
name: open-insight-core
description: Use when working with the @open-insight/core package. Covers the sandbox provider abstraction and built-in Docker and Apple providers, resource and network policies, container and instruction snapshots, the agent provider service contract, prompt trajectories, and ACP prompt and stream conversion.
---

# Open Insight Core

`@open-insight/core` is the core abstraction layer for Open Insight.
Public APIs are grouped into namespaces: `Sandbox`, `Resource`, `Snapshot`, `Agent`, `Prompt`, and `Acp`.

## Sandbox

`Sandbox.Provider` is the service contract for running commands and file operations in an isolated environment.

A provider acquires a snapshot handle, derives new handles from instructions, and runs a sandbox from a handle:

- `aquireSnapshot({ snapshot, cache })` — get a handle to a snapshot, guaranteed to exist during the scope.
- `deriveSnapshot({ handle, instructions, context, cache })` — derive a new handle from an existing one.
- `runSandbox({ handle, resources })` — run a sandbox from a handle.

`Sandbox.ProviderService` is the `Context.Service` tag used to provide the provider.
Built-in providers live under `Sandbox.Docker` and `Sandbox.Apple`.

A sandbox itself supports `spawn`, `readFile`, `writeFile`, `download`, `upload`, `expose`, `exitCode`, `stdout`, `stderr`, and `cmd`.

## Resource

`Resource.Resources` is the schema describing what a sandbox may access.
`Resource.Policy` controls network access with a `Mode` of `public`, `no-network`, or `allowlist`.
In `allowlist` mode, `allowedHosts` must contain exact hostnames, leading-wildcard hostnames, IP addresses, or CIDRs — never URLs, ports, or paths.

## Snapshot

A `Snapshot.Snapshot` is either an `InstructionsSnapshot` or a `ContainerfileSnapshot`.

- `Snapshot.make(image)` or `Snapshot.makeWith({ instructions })` — build a snapshot; `Snapshot.Scratch` is the empty scratch snapshot.
- `Snapshot.extend(snapshot, instructions)` — append instructions.
- `Snapshot.build`, `Snapshot.encode`, `Snapshot.hash` — build, encode, and hash snapshots.
- `Snapshot.writeInstructions` — write an instruction snapshot to a directory.
- `Snapshot.Image` and `Snapshot.Handle` — image helpers and provider handles.

## Agent

`Agent` provides the provider service contract shared across agent implementations: `Agent.Provider`, `Agent.SnapshotExtension`, `Agent.StreamPart`, and `Agent.Toolset`.

## Prompt

`Prompt` is the trajectory representation used by agent loops: `Prompt.empty`, `Prompt.make`, `Prompt.concat`, and `Prompt.fromResponseParts`.

## Acp

`Acp` converts prompts and streams to and from the Agent Client Protocol:

- `Acp.toAcpPrompt(prompt, options)` — convert a prompt to an ACP prompt.
- `Acp.transform` — transform ACP stream parts.
- `Acp.PromptCapability` and `Acp.PromptError` — capability and error handling.
