# Harness

`Harness` coordinates snapshots, sandboxes, and an agent provider.

```ts
const harness = yield* Harness.make("my-harness", {
  name: "My Harness",
  description: "Runs a task in an isolated sandbox",
});
```

`Harness.runSnapshot(template)` acquires and derives a snapshot inside the
current `Scope`. Equivalent templates share a reference-counted snapshot.

```ts
const snapshotSession = yield* harness.runSnapshot(template);
const sandboxSession = yield* snapshotSession.runSandbox({
  resources: Resource.make({ memoryMiB: 4096 }),
});
const agentSession = yield* sandboxSession.runAgent();
```

The resulting `AgentSession` exposes the agent `trajectory` and a
`prompt(prompt)` stream of `Response.StreamPartEncoded` values. Snapshot and
sandbox failures are reported as `HarnessError`; agent failures are wrapped as
`HarnessError` as well.
