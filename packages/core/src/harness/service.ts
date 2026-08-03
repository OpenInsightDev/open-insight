import type * as Agent from "#/agent/index.ts";
import type * as Sandbox from "#/sandbox/index.ts";

/**
 * The union of provider services provided by a harness: the agent provider
 * that runs sessions and the sandbox provider that executes them.
 *
 * Inspired by `NodeServices` from `@effect/platform-node`, which aggregates
 * the low-level platform services into a single union so one layer can
 * provide them all.
 *
 * A `Layer.Layer<HarnessServices>` is composed at the edge with `Layer.provideMerge`,
 * where the agent and sandbox layers are independent:
 *
 * ```ts
 * Layer.provideMerge(Acp.harness(url, agentId, options), Sandbox.Docker.layer())
 * ```
 */
export type HarnessServices = Agent.ProviderService | Sandbox.ProviderService;
