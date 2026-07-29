# Define an Agent Snapshot Extension

An `Agent.SnapshotExtension` installs the files and runtime dependencies that an agent needs inside a task sandbox.
The eval runner first acquires the task snapshot and then derives an agent-specific snapshot by applying the extension instructions.
This keeps agent setup separate from task setup and prevents every task author from having to install a particular agent.

A snapshot extension is not a complete `Snapshot`.
It has no `image` because it is applied on top of the task's existing snapshot, whose operating system, package manager, installed tools, user, and working directory may be unknown.
The extension uses the same provider-independent `Snapshot.Instructions` format, but its instructions must be written more defensively than task snapshot instructions.
Extensions are not applied in verification mode, so agent dependencies do not modify the environment used to compute the reference grade.

## Shape and Context

```ts
type SnapshotExtension = Readonly<{
  instructions: Snapshot.Instructions;
  context?: string;
}>;
```

`instructions` are applied in order to the acquired task snapshot.
`context` is the absolute host directory used by `Snapshot.copy` instructions.
When `context` is omitted, the eval runner uses the task snapshot's context.
Reusable agents should normally provide their own context instead of assuming that every task context contains agent assets.

An agent provider exposes the extension through `snapshotExtension: Option.Option<Agent.SnapshotExtension>`.
Use `Option.none()` only when the agent needs no additional sandbox setup.

## Write Defensive Instructions

Do not assume that a non-baseline tool exists merely because it is common in one base image.
Place `Snapshot.available(...)` before the first `Snapshot.run(...)` that uses those commands.
Check dependencies whose availability commonly varies between images, such as `tar`, `curl`, `git`, `node`, `python`, or a package manager.
Do not mechanically check baseline shell and core utility commands such as `sh`, `rm`, or `mkdir`.

Use `Snapshot.assert(...)` for assumptions that command discovery cannot prove, such as a minimum version, a supported architecture, a writable destination, or the presence of a required file.
Validate the installed executable after installation so that failures occur while deriving the snapshot rather than when the agent session starts.

Do not assume that the extension runs as root or starts in a particular working directory.
Use absolute paths, set `Snapshot.workdir(...)` when the agent requires one, and check write permissions before installing into system directories.
Prefer copying a pinned, self-contained runtime from the extension context when that is more portable than invoking an unknown system package manager.

If an agent supports only a known family of base environments, state that requirement and fail early with assertions.
Do not hide an unsupported base behind long package-manager fallback scripts because they are difficult to reproduce and diagnose.

## Example

The following extension installs a bundled agent runtime from an archive without assuming that the task image contains a language package manager.
It checks every command and filesystem assumption before the installation run step, then verifies the installed executable afterward.

```ts
import { Agent, Snapshot } from "@open-insight/eval";
import { resolve } from "@std/path";

const context = resolve(import.meta.dirname!, "agent-runtime");

export const snapshotExtension = {
  context,
  instructions: [
    Snapshot.available("tar"),
    Snapshot.assert("test -d /opt", "test -w /opt"),
    Snapshot.copy(["open-insight-agent.tar.gz"], "/tmp/open-insight-agent.tar.gz"),
    Snapshot.run(
      "mkdir -p /opt/open-insight-agent && " +
        "tar -xzf /tmp/open-insight-agent.tar.gz -C /opt/open-insight-agent && " +
        "rm /tmp/open-insight-agent.tar.gz",
    ),
    Snapshot.assert("test -x /opt/open-insight-agent/bin/open-insight-agent"),
  ],
} satisfies Agent.SnapshotExtension;
```

This example expects `agent-runtime/open-insight-agent.tar.gz` next to the module.
The archive must contain a runtime compatible with the target operating system and architecture, and those constraints should be asserted when the agent can encounter multiple targets.

Attach the value to the provider with `Option.some(snapshotExtension)`.
The eval runner will derive and cache the agent-specific snapshot according to its snapshot cache configuration.

## Review Checklist

- Keep the extension limited to dependencies required to run the agent.
- Provide an extension-owned absolute `context` for copied assets.
- Check non-baseline command dependencies with `Snapshot.available` before using them in `Snapshot.run`.
- Assert versions, permissions, architecture, and other environmental assumptions explicitly.
- Use absolute paths instead of inheriting an unknown task working directory.
- Verify the final agent executable before the extension completes.
- Pin downloaded or copied artifacts so the derived snapshot is reproducible.
