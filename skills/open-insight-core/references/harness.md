# Harness

`Harness` runs a task inside a sandbox with an agent attached. Given a `Snapshot.Snapshot`, a harness:

1. acquires a task snapshot from the sandbox provider (cached per `cacheTaskSnapshot`),
2. derives a run snapshot from the agent provider's `snapshotExtension` when one is declared (cached per `cacheAgentSnapshot`),
3. starts the sandbox with the run snapshot and the given `Resource.Resources`,
4. and exposes a `runSession()` that opens an `Agent` session bound to that sandbox.

A harness is identified by `metadata` (`id`, optional `name`/`description`) and is provided as an Effect `Service`:

```ts
import { Harness } from "@open-insight/core";

const harness = Harness.Service.layer("my-harness", {
  name: "My Harness",
  description: "Runs the task in an isolated sandbox",
});
```

The layer requires `Agent.ProviderService` and `Sandbox.ProviderService`, and
provides `Harness.Service` to downstream consumers.

`harness.snapshotExtension` exposes the optional agent snapshot extension used
by the harness. Evaluation uses this value to prepare the same derived snapshot
before trails start.

## Building and Running a Task

`harness.build(snapshot, options?)` builds the snapshot into a `Built` inside a `Scope` — the snapshot handle lives for the scope's lifetime:

```ts
const built = yield* harness.build(task.snapshot, {
  cacheTaskSnapshot: true,
  cacheAgentSnapshot: false,
});
```

A `Built` exposes the `snapshotHandle` used to run the sandbox, plus a `runSandbox(options?)` method that starts the sandbox with it and the given `Resource.Resources`:

```ts
const run = yield* built.runSandbox({
  resources: Resource.make({ memoryMiB: 4096 }),
});

const session = yield* run.runSession();
```

A `Session` exposes `trajectory` (the accumulated agent trajectory) and `prompt(prompt)`, a `Stream` of `StreamPartEncoded` parts.

## Errors

All harness failures are reported as `HarnessError`, a single tagged wrapper over `ErrorReason`:

- `Harness.InitError` — harness initialization failed.
- `Harness.SnapshotAcquireError` — the task snapshot could not be acquired from the sandbox provider (carries the requested `snapshot`).
- `Harness.SnapshotDeriveError` — the agent's `snapshotExtension` could not be applied (carries the `instructions`).
- `Harness.SandboxRunError` — the sandbox could not be started.
- `Harness.SessionNotStartedError` — `runSession()` was used before a session was started.
- `Agent.AgentError` — the agent session or stream failed.

Each factory wraps a lower-boundary error; discriminate with `Effect.catchTag` on the variant `_tag` (e.g. `"SnapshotAcquireError"`), or match the union with `Harness.ErrorReason`.
