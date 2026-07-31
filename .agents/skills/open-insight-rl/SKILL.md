---
name: open-insight-rl
description: Use when working on the @open-insight/rl package — the in-development local harness server that provides rollout, reward, and evaluation APIs to reinforcement learning frameworks through a client/server architecture.
---

# Open Insight RL

Work on the `@open-insight/rl` package, a local agent harness server for reinforcement learning frameworks.

The server is intended to expose rollout, reward, and evaluation APIs that RL frameworks consume over a client/server architecture.

Python RL frameworks connect through per-framework client plugins instead of bespoke harness adapters.

Read `packages/rl/docs/dev.md` before making changes; the public API surface is not implemented yet, so ground new code in the design doc and the existing package layout.
