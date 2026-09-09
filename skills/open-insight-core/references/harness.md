# Harness

`Harness` coordinates snapshots, sandboxes, and an agent provider.

```ts
const harness =
  yield *
  Harness.make("my-harness", {
    name: "My Harness",
    description: "Runs a task in an isolated sandbox",
  });
```

`Harness.runSandbox(template, options)` acquires and derives a snapshot inside the
current `Scope`, then runs a sandbox from it.
Equivalent templates share one reference-counted snapshot.

```ts
const sandboxSession =
  yield *
  harness.runSandbox(template, {
    resources: Resource.make({ memoryMiB: 4096 }),
  });
const agentSession = yield * sandboxSession.runAgent();
```

The resulting `AgentSession` exposes the agent `trajectory` and a
`prompt(prompt)` stream of `Response.StreamPartEncoded` values. Snapshot and
sandbox failures are reported as `HarnessError`; agent failures are wrapped as
`HarnessError` as well.
