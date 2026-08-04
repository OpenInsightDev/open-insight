# Resource

`Resource.Resources` describes the limits and access granted to a sandbox: CPUs, GPUs, memory, storage, network access, and build/run timeouts.
Every field is optional, and an empty `Resources` (the default) imposes no explicit limits, leaving each provider to apply its own defaults.

## Fields

- `numCPUs` — number of CPUs; fractional values are allowed (e.g. `0.5` for half a CPU).
- `numGPUs` — number of GPUs; a non-negative integer.
- `memoryMiB` — memory in MiB.
- `storageMiB` — storage in MiB.
- `network` — the network policy applied while the sandbox runs; a `Resource.Policy`.
- `buildTimeoutSec` — maximum time allowed to build the snapshot, in seconds.
- `runTimeoutSec` — maximum time allowed for the sandbox to run, in seconds.

Build a value with `Resource.make(options)`.

```ts
import { Resource } from "@open-insight/core";

const resources = Resource.make({
  numCPUs: 2,
  memoryMiB: 4096,
  network: "no-network",
  runTimeoutSec: 600,
});
```

## Network Policy

`Resource.Policy` controls what a sandbox can reach while it runs. `mode` is one of:

- `public` — unrestricted network access (the default when no policy is set).
- `no-network` — network access disabled entirely.
- `allowlist` — only the hosts listed in `allowedHosts` are reachable.

`allowedHosts` must be empty unless `mode` is `allowlist`.
Each entry must be an exact hostname (a trailing dot is allowed), a leading-wildcard hostname such as `*.example.com`, an IP address, or a CIDR range — never a URL, port, or path.

```ts
const policy = Resource.Policy.make({
  mode: "allowlist",
  allowedHosts: ["example.com", "*.example.com", "192.0.2.1", "2001:db8::/32"],
});
```

Passed to `Resource.make`, simple modes are plain strings and `allowlist` is an object keyed by the mode:

```ts
const resources = Resource.make({
  network: { allowlist: ["example.com", "*.example.com"] },
});
```

Prefer `no-network` for tasks that do not need network access, and use `allowlist` to grant access only to the hosts a task actually requires.

## Provider Behavior

Resource values are hints applied when the sandbox starts, and providers differ in what they enforce.
For example, the Docker provider maps CPUs, memory, GPUs, and storage to container limits, and `no-network` disables networking entirely.
Keep resource fields conservative so a benchmark runs on as many providers as possible.
